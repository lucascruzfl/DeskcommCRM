import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { test, expect } from "./helpers/test";
import { managedFixture } from "./helpers/managed-client-fixture";
import { createManagedOnboardingService } from "../../lib/managed-clients/onboarding";
import { createIspPackageService, ISP_FIELDS, ISP_STAGES, ISP_TAGS } from "../../lib/managed-clients/isp-package";
import { ispAiId } from "../../lib/managed-clients/isp-ai";
import { audit } from "../../lib/audit";
import { bufToBytea, encryptKey } from "../../lib/crypto/aes_gcm";
import { createPool } from "../../lib/agent-engine/db/pool";
import { seedPlatformPlaybook } from "../../lib/agent-engine/agent/playbook-seed";

/** Certificação sintética: Supabase local, convite capturado, canal sem WAHA. */
test("Fibra Horizonte Demo: reunião → tenant → acervo/memória MCP → drafts 7C", async ({ request, page }) => {
  test.setTimeout(300_000);
  expect(process.env.INTERNAL_AGENT_RUN_STUB, "provider controlado obrigatório; sem chamada externa").toBe("true");
  const fixture = await managedFixture();
  const manager = fixture.users.manager!;
  const client = fixture.users.outsider!;
  const ids: string[] = [];
  let orgId: string | null = null;
  const check = <T>(result: { data: T; error: { message: string } | null }): NonNullable<T> => {
    if (result.error) throw new Error(result.error.message);
    if (result.data === null || result.data === undefined) throw new Error("fixture result absent");
    return result.data;
  };
  const noError = (result: { error: { message: string } | null }) => {
    if (result.error) throw new Error(result.error.message);
  };
  const humanStep = (...args: string[]) => execFileSync("pnpm", [
    "exec", "tsx", "tests/e2e/helpers/managed-isp-human-fixture.ts", ...args,
  ], { encoding: "utf8", timeout: 30_000 }).trim();
  async function token(tenant: string, handoff = false) {
    const id = randomUUID();
    const prefix = `dsk_${randomBytes(4).toString("hex")}`;
    const value = `${prefix}_${randomBytes(32).toString("base64url")}`;
    const hash = createHash("sha256").update(value).digest("hex");
    noError(await fixture.db.from("api_tokens").insert({
      id, organization_id: tenant, created_by: manager.id, name: "7D synthetic pilot",
      prefix, token_hash: `\\x${hash}`,
      scopes: ["role:admin", "mcp:read", "mcp:write", "capability:managed_client_onboarding",
        ...(handoff ? ["capability:human_handoff"] : [])],
    }));
    ids.push(id);
    return value;
  }
  let rpcId = 1;
  async function call(bearer: string, name: string, args: Record<string, unknown> = {}) {
    const id = rpcId++;
    const response = await request.post("/api/mcp", {
      headers: { authorization: `Bearer ${bearer}`, accept: "application/json, text/event-stream" },
      data: { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } },
    });
    expect(response.status()).toBe(200);
    const body = await response.text();
    const frames = body.trim().startsWith("{") ? [JSON.parse(body)] : body.split("\n")
      .filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
    const frame = frames.find((item: { id?: number }) => item.id === id);
    expect(frame?.result?.isError, JSON.stringify(frame)).not.toBe(true);
    const content = frame?.result?.content?.find((item: { text?: string }) => item.text);
    if (!content) throw new Error(`MCP ${name}: result absent (${JSON.stringify(frame)})`);
    return JSON.parse(content.text) as Record<string, unknown>;
  }
  try {
    noError(await fixture.db.from("platform_admins").insert({
      user_id: manager.id, granted_by: manager.id, scope: "full", mfa_required: false,
      reason: "7D synthetic pilot",
    }));
    const sourceToken = await token(fixture.clinics.A!.id);
    const listed = await call(sourceToken, "crm_list_managed_client_presets");
    expect(JSON.stringify(listed)).toContain("managed/internet-provider");

    const suffix = randomUUID().slice(0, 8);
    const input = {
      organization_name: "Fibra Horizonte Demo", preset: "managed/internet-provider" as const,
      client_email: client.email, slug: `fibra-horizonte-demo-${suffix}`,
      idempotency_key: randomUUID(),
    };
    const publicPlan = await call(sourceToken, "crm_preflight_managed_client", {
      name: input.organization_name, slug: input.slug, client_email: input.client_email,
      business_type: "internet_provider", management_mode: "managed",
    });
    expect(publicPlan.preset).toMatchObject({ id: "managed/internet-provider" });
    const actor = { userId: manager.id, sourceOrganizationId: fixture.clinics.A!.id,
      requestId: randomUUID(), apiTokenId: null };
    // O transporte de convite é substituído apenas no processo de teste.
    let invitations = 0;
    const service = createManagedOnboardingService({
      admin: () => fixture.db,
      emailConfigured: async () => true,
      issueInvite: async (invite) => {
        invitations++;
        return { email: invite.email, invite_id: invite.inviteId!,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          email_dispatched: true, email_error: undefined, accept_url: "fixture-only-no-email" };
      },
      audit,
      applyIspPackage: createIspPackageService({ admin: () => fixture.db, audit }).execute,
    });
    const preflight = await service.preflight(input, actor);
    expect(preflight).toMatchObject({ can_execute: true, requires_confirmation: true });
    expect(check(await fixture.db.from("organizations").select("id").eq("slug", input.slug))).toEqual([]);
    const created = await service.execute(input, actor, true);
    if (!("organization_id" in created)) throw new Error("missing synthetic tenant");
    orgId = created.organization_id;
    expect(created.status).toBe("completed");
    expect(await service.execute(input, actor, true)).toMatchObject({ status: "already_completed" });
    expect(invitations).toBe(1);

    const targetToken = await token(orgId, true);
    const operational = await call(targetToken, "crm_configure_managed_internet_provider", { confirm: false });
    expect(operational.a_criar).toEqual([]);
    expect(operational.conflitos).toEqual([]);
    const pipeline = check(await fixture.db.from("crm_pipelines").select("id,name,settings")
      .eq("organization_id", orgId).eq("slug", "vendas-internet").single());
    expect(pipeline.name).toBe("Vendas — Internet");
    expect(check(await fixture.db.from("crm_stages").select("name").eq("organization_id", orgId)
      .eq("pipeline_id", pipeline.id)).map((stage) => stage.name)).toEqual(expect.arrayContaining(ISP_STAGES.map((stage) => stage.nome)));
    expect((pipeline.settings as { fields: Array<{ key: string }> }).fields.map((field) => field.key))
      .toEqual(expect.arrayContaining(ISP_FIELDS.map((field) => field.key)));
    expect((pipeline.settings as { lost_reasons: Array<{ label: string }> }).lost_reasons.map((reason) => reason.label))
      .toEqual(["Sem cobertura", "Desistiu", "Sem retorno"]);
    const org = check(await fixture.db.from("organizations").select("settings").eq("id", orgId).single());
    expect((org.settings as { tags: string[] }).tags).toEqual(expect.arrayContaining([...ISP_TAGS]));
    expect(check(await fixture.db.from("automation_rules").select("trigger_event,actions")
      .eq("organization_id", orgId).like("name", "ISP:%"))).toHaveLength(3);

    const source = await call(targetToken, "crm_create_knowledge_source", {
      name: "Acervo fictício Fibra Horizonte Demo", source_type: "faq",
      items: [
        { question: "Onde há rede?", answer: "Há rede informada em Centro, Planalto, São José e Lagoa Nova. Cobertura exata exige endereço completo e confirmação humana." },
        { question: "Quais são os planos residenciais?", answer: "300 Mbps por R$ 79,90; 500 Mbps por R$ 99,90; 700 Mbps por R$ 119,90. Valores fictícios deste piloto." },
        { question: "Qual é o horário?", answer: "Atendimento humano de segunda a sexta das 8h às 18h, sábado das 8h às 12h. Mensagens podem chegar fora do horário." },
        { question: "Qual é o suporte básico?", answer: "Conferir se ONU e roteador estão ligados, observar as luzes; desligar somente o roteador por cerca de 30 segundos e religar uma vez. Persistindo, equipe humana." },
        { question: "Qual a previsão de instalação?", answer: "Normalmente até três dias úteis após cobertura e documentos confirmados; previsão sujeita à agenda da equipe, sem data exata garantida." },
      ],
    });
    const knowledgeId = (source.fonte as { id: string }).id;
    expect(source.indexacao_solicitada).toBe(true);
    const savedKnowledge = (await call(targetToken, "crm_get_knowledge_source", {
      knowledge_source_id: knowledgeId,
    })).fonte as { id: string; items: Array<{ answer: string }> };
    expect(savedKnowledge.id).toBe(knowledgeId);
    expect(savedKnowledge.items).toHaveLength(5);
    const knowledgeText = savedKnowledge.items.map((item) => item.answer).join(" ");
    expect(knowledgeText).toContain("Centro, Planalto, São José e Lagoa Nova");
    expect(knowledgeText).toContain("300 Mbps por R$ 79,90; 500 Mbps por R$ 99,90; 700 Mbps por R$ 119,90");
    expect(knowledgeText).toContain("confirmação humana");
    expect(knowledgeText).toContain("três dias úteis");
    const memory = await call(targetToken, "crm_save_org_memory", {
      titulo: "Limites de atendimento do piloto fictício",
      corpo: "Nunca confirmar cobertura pelo bairro ou CEP; verificar endereço completo com pessoa. Não prometer instalação grátis sem política confirmada. Segunda via, pagamento e desbloqueio exigem pessoa; nunca inventar boleto ou PIX. Não registrar senha Wi-Fi. Data de instalação exige confirmação humana. Abrir caso para retaguarda e fazer handoff quando o cliente pedir pessoa; só pessoa devolve à IA.",
    });
    expect((memory.anotacao as { id: string }).id).toBeTruthy();
    const savedMemory = JSON.stringify(await call(targetToken, "crm_get_org_memory"));
    expect(savedMemory).toContain("Limites de atendimento");
    expect(savedMemory).toContain("Não prometer instalação grátis");
    expect(check(await fixture.db.from("org_memory_entries").select("source,created_by")
      .eq("organization_id", orgId).eq("id", (memory.anotacao as { id: string }).id).single()))
      .toMatchObject({ source: "manual", created_by: manager.id });

    const channelId = randomUUID();
    noError(await fixture.db.from("channel_sessions").insert({
      id: channelId, organization_id: orgId, waha_session_name: `7d-fixture-${suffix}`,
      webhook_secret_encrypted: "\\x00", status: "WORKING", display_name: "Canal fictício sem WAHA",
    }));
    const credentialId = randomUUID();
    const syntheticKey = encryptKey("local-controlled-provider");
    noError(await fixture.db.from("ai_provider_credentials").insert({
      id: credentialId, organization_id: orgId, provider: "anthropic", label: "Credencial fictícia sem acesso externo",
      api_key_encrypted: bufToBytea(syntheticKey.ciphertext),
      api_key_iv: bufToBytea(syntheticKey.iv), api_key_tag: bufToBytea(syntheticKey.tag),
      api_key_last4: syntheticKey.last4,
      validated_at: new Date().toISOString(), models_available: ["claude-sonnet-4-6"], created_by: manager.id,
    }));
    const ai = { provider: "anthropic", model: "claude-sonnet-4-6", credential_id: credentialId,
      channel_session_id: channelId, knowledge_source_ids: [knowledgeId] };
    const followups = {
      plano_apresentado: { wait_minutes: 1440, task_due_days: 0 },
      aguardando_documentos: { wait_minutes: 2880, task_due_days: 0 },
      instalacao: { wait_minutes: 1440, task_due_days: 0 },
      sem_cobertura: { wait_minutes: 43200, task_due_days: 0 },
    };
    const plan = await call(targetToken, "crm_configure_managed_internet_provider_ai", { ai, followups, confirm: false });
    expect(plan.can_execute).toBe(true);
    expect(plan.conflitos).toEqual([]);
    const prepared = await call(targetToken, "crm_configure_managed_internet_provider_ai", { ai, followups, confirm: true });
    expect(prepared.status).toBe("prepared");
    expect(check(await fixture.db.from("ai_agents").select("id,is_active,published_version_id")
      .eq("organization_id", orgId))).toHaveLength(5);
    const versions = check(await fixture.db.from("ai_agent_versions")
      .select("id,agent_id,status,knowledge_source_ids,tool_ids,system_prompt")
      .eq("organization_id", orgId));
    expect(versions).toHaveLength(5);
    expect(versions.every((version) => version.status === "draft" && version.knowledge_source_ids.includes(knowledgeId))).toBe(true);
    const installation = versions.find((version) => version.agent_id === ispAiId(orgId!, "agent:instalacao"));
    expect(installation?.tool_ids).toContain("crm_search_knowledge");
    expect(installation?.system_prompt).toContain("não invente data");
    const finance = versions.find((version) => version.agent_id === ispAiId(orgId!, "agent:financeiro"));
    expect(finance?.system_prompt).toContain("Não gere boleto ou PIX");
    expect(finance?.system_prompt).toContain("nem desbloqueie conexão");
    expect(JSON.stringify(await call(targetToken, "crm_list_ai_agents"))).toContain("Comercial ISP");
    const dbUrl = process.env.SUPABASE_DB_URL;
    if (!dbUrl || !["localhost", "127.0.0.1"].includes(new URL(dbUrl).hostname)) {
      throw new Error("pilot playbook seed requires disposable localhost Postgres");
    }
    const pool = createPool(dbUrl);
    try { await seedPlatformPlaybook(pool); } finally { await pool.end(); }
    for (const [role, message] of [
      ["geral", "Preciso de ajuda"], ["comercial", "Quero contratar internet"],
      ["comercial", "Meu CEP é 00000-000, tem cobertura?"],
      ["comercial", "Quais planos vocês têm?"],
      ["suporte", "Minha internet caiu"], ["financeiro", "Me manda a segunda via"],
      ["financeiro", "Já paguei, libera minha internet"],
      ["instalacao", "Quando o técnico vem?"],
    ] as const) {
      const preview = await call(targetToken, "crm_test_ai_agent_version", {
        agent_id: ispAiId(orgId, `agent:${role}`),
        version_id: ispAiId(orgId, `version:${role}`),
        sample_message: message,
      });
      expect(preview.stub).toBe(true);
      expect(preview.run_id).toBeTruthy();
    }
    const router = check(await fixture.db.from("ai_routers").select("id,is_active,fallback_agent_id")
      .eq("organization_id", orgId).single());
    expect(router).toMatchObject({ is_active: false, fallback_agent_id: ispAiId(orgId, "agent:geral") });
    const routerPublic = await call(targetToken, "crm_get_ai_router", { router_id: router.id });
    expect((routerPublic.members as unknown[])).toHaveLength(4);
    expect(check(await fixture.db.from("ai_router_members").select("intent_name")
      .eq("organization_id", orgId).eq("router_id", router.id)).map((row) => row.intent_name).sort())
      .toEqual(["comercial", "financeiro", "instalacao", "suporte"]);
    const flows = check(await fixture.db.from("followup_flow_pointers")
      .select("name,status,trigger_config,draft_graph")
      .eq("organization_id", orgId).eq("surface", "followup"));
    expect(flows).toHaveLength(4);
    expect(JSON.stringify(await call(targetToken, "crm_list_followup_flows"))).toContain("ISP · Plano apresentado sem resposta");
    expect(flows.every((flow) => flow.status === "draft" &&
      (flow.draft_graph as { settings: { somente_interno: boolean } }).settings.somente_interno)).toBe(true);
    for (const [label, waitMinutes] of [
      ["Plano apresentado", 1440], ["Aguardando documentos", 2880],
      ["Instalação parada", 1440], ["Sem cobertura", 43200],
    ] as const) {
      const flow = flows.find((item) => item.name.toLocaleLowerCase("pt-BR").includes(label.toLocaleLowerCase("pt-BR")));
      expect(flow, label).toBeDefined();
      const nodes = (flow!.draft_graph as { nodes: Array<{ type: string; config: Record<string, unknown> }> }).nodes;
      expect(nodes.find((node) => node.type === "wait")?.config.duration_ms).toBe(waitMinutes * 60_000);
      expect(nodes.find((node) => node.type === "internal_task")?.config.vence_em_dias).toBe(0);
    }
    expect(flows.find((flow) => flow.name.includes("Plano apresentado"))?.trigger_config)
      .toMatchObject({ kind: "stage_change", cancel_on_reply: true });
    expect(flows.find((flow) => flow.name.toLocaleLowerCase("pt-BR").includes("sem cobertura"))?.trigger_config).toMatchObject({ kind: "manual" });
    expect((await call(targetToken, "crm_configure_managed_internet_provider_ai", { ai, followups, confirm: true })).status)
      .toBe("already_prepared");
    expect(check(await fixture.db.from("ai_agents").select("id").eq("organization_id", orgId))).toHaveLength(5);

    // Token de outro tenant não alcança nenhuma referência do piloto.
    for (const [name, args] of [
      ["crm_get_ai_agent", { agent_id: ispAiId(orgId, "agent:comercial") }],
      ["crm_get_knowledge_source", { knowledge_source_id: knowledgeId }],
      ["crm_get_channel_admin", { channel_id: channelId }],
      ["crm_get_ai_router", { router_id: router.id }],
      ["crm_test_ai_router", { router_id: router.id, message: "Quero contratar internet" }],
      ["crm_get_followup_flow", { flow_id: ispAiId(orgId, "followup:plano_apresentado") }],
    ] as const) {
      const foreign = await request.post("/api/mcp", {
        headers: { authorization: `Bearer ${sourceToken}`, accept: "application/json, text/event-stream" },
        data: { jsonrpc: "2.0", id: rpcId++, method: "tools/call", params: { name, arguments: args } },
      });
      expect(await foreign.text(), name).toContain("isError");
    }
    expect(check(await fixture.db.from("messages").select("id").eq("organization_id", orgId))).toEqual([]);
    expect(check(await fixture.db.from("send_ledger").select("id").eq("organization_id", orgId))).toEqual([]);

    // A fixture cria apenas a conversa local. As transições seguintes usam as
    // funções canônicas do engine, sem adapter de canal nem aviso externo.
    const contactId = randomUUID();
    const conversationId = randomUUID();
    noError(await fixture.db.from("contacts").insert({
      id: contactId, organization_id: orgId, name: "Assinante Sintético ISP",
    }));
    noError(await fixture.db.from("conversations").insert({
      id: conversationId, organization_id: orgId, contact_id: contactId,
      channel_session_id: channelId, status: "ai_handling", assignee_kind: "ai",
    }));
    const caseId = humanStep("open", orgId, conversationId, contactId,
      ispAiId(orgId, "agent:comercial"));
    expect((await call(targetToken, "crm_get_human_case", { case_id: caseId })).status)
      .toBe("awaiting_human");
    expect(check(await fixture.db.from("conversations").select("bot_silenced_until")
      .eq("organization_id", orgId).eq("id", conversationId).single()).bot_silenced_until).toBeNull();
    expect(humanStep("handoff", orgId, conversationId, contactId, "", caseId)).toBe("handoff_recorded");
    expect(humanStep("is_silenced", orgId, conversationId, contactId)).toBe("true");
    const handoffs = await call(targetToken, "crm_list_handoff_history", { conversation_id: conversationId });
    expect(handoffs.handoffs).toEqual(expect.arrayContaining([
      expect.objectContaining({ caso_id: caseId, motivo_codigo: "requested_human" }),
    ]));
    const passed = check(await fixture.db.from("conversations")
      .select("status,bot_silenced_until")
      .eq("organization_id", orgId).eq("id", conversationId).single());
    expect(passed.status).toBe("pending");
    expect(passed.bot_silenced_until).not.toBeNull();

    // A tela mostra o caso à pessoa antes da decisão e os drafts preparados.
    check(await fixture.db.from("organizations").update({ onboarded_at: new Date().toISOString() })
      .eq("id", orgId).select("id").single());
    await page.goto("/login");
    await page.locator("#email").fill(manager.email);
    await page.locator("#password").fill(fixture.password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.waitForURL(/\/app\//);
    await page.getByTestId("tenant-switcher").click();
    await page.getByTestId(`tenant-switcher-item-${orgId}`).click();
    await expect(page.getByRole("button", { name: /Organização: Fibra Horizonte Demo/ }))
      .toBeVisible({ timeout: 20_000 });
    await page.goto("/app/ai/cases");
    await page.getByText("Confirmar cobertura do endereço fictício").first().click();
    await expect(page.getByRole("heading", { name: "Assinante Sintético ISP" })).toBeVisible();
    await expect(page.getByText("Uma pessoa precisa confirmar endereço completo e porta disponível.")).toBeVisible();
    mkdirSync("evidence/managed", { recursive: true });
    const caseScreenshot = await page.screenshot({ path: "evidence/managed/isp-7d-human-case.png", fullPage: true });
    await test.info().attach("isp-7d-human-case", { body: caseScreenshot, contentType: "image/png" });

    expect(humanStep("resolve", orgId, conversationId, contactId, "", caseId, manager.id))
      .toBe("human_decision_recorded");
    const resolvedCase = await call(targetToken, "crm_get_human_case", { case_id: caseId });
    expect(resolvedCase.status).toBe("resolved");
    expect(JSON.stringify(resolvedCase.human_continuity)).toContain("Conferência humana concluída");
    const resumed = await call(targetToken, "crm_resume_ai_attendance", { conversation_id: conversationId });
    expect(resumed).toMatchObject({ resumed: true, already_with_agent: false });
    expect(JSON.stringify(resumed.human_continuity)).toContain("Conferência humana concluída");
    expect(humanStep("is_silenced", orgId, conversationId, contactId)).toBe("false");
    expect(check(await fixture.db.from("conversations").select("assignee_kind,bot_silenced_until")
      .eq("organization_id", orgId).eq("id", conversationId).single()))
      .toMatchObject({ assignee_kind: "ai", bot_silenced_until: null });
    expect(check(await fixture.db.from("send_ledger").select("id").eq("organization_id", orgId))).toEqual([]);
    expect(check(await fixture.db.from("messages").select("id").eq("organization_id", orgId))).toEqual([]);
    await page.goto("/app/ai/agents");
    await expect(page.getByText("Comercial ISP").first()).toBeVisible();
    mkdirSync("evidence/managed", { recursive: true });
    const screenshot = await page.screenshot({ path: "evidence/managed/isp-7d-synthetic-drafts.png", fullPage: true });
    await test.info().attach("isp-7d-synthetic-drafts", { body: screenshot, contentType: "image/png" });
  } finally {
    await page.close();
    if (orgId) await fixture.db.from("organizations").delete().eq("id", orgId);
    if (ids.length) await fixture.db.from("api_tokens").delete().in("id", ids);
    await fixture.db.from("platform_admins").delete().eq("user_id", manager.id);
    await fixture.cleanup();
  }
});
