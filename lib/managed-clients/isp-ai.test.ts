import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { destinoDoVeredito } from "@/lib/agent-engine/agent/resolve-turn-agent";
import { parseIntentVerdict } from "@/lib/agent-engine/agent/intent-classifier";
import type { LoadedRouter } from "@/lib/agent-engine/agent/router-config";

import { createIspAiService, ispAiId, ISP_AI_INTENTS, ISP_AI_ROLES } from "./isp-ai";

const ORG = "11111111-1111-4111-8111-111111111111";
const ORG_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "22222222-2222-4222-8222-222222222222";
const PIPELINE = "33333333-3333-4333-8333-333333333333";
const CHANNEL = "44444444-4444-4444-8444-444444444444";
const CREDENTIAL = "55555555-5555-4555-8555-555555555555";
const KNOWLEDGE = "66666666-6666-4666-8666-666666666666";
const FLOW = "77777777-7777-4777-8777-777777777777";
const B_CREDENTIAL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const B_CHANNEL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const B_KNOWLEDGE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const B_FLOW = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const actor = { userId: USER, requestId: "req-7c" };
const ai = {
  provider: "openai",
  model: "gpt-test",
  credential_id: CREDENTIAL,
  channel_session_id: null as string | null,
  knowledge_source_ids: [] as string[],
};

type Row = Record<string, unknown>;
type Store = Record<string, Row[]>;

function fixture(preset = "managed/internet-provider") {
  const rows: Store = {
    platform_admins: [{ user_id: USER, scope: "full", mfa_required: false, revoked_at: null }],
    user_organizations: [
      {
        user_id: USER,
        organization_id: ORG,
        role: "admin",
        revoked_at: null,
        accepted_at: "2026-01-01",
      },
    ],
    managed_client_policies:
      preset === "ordinary"
        ? []
        : [
            {
              organization_id: ORG,
              business_type:
                preset === "managed/internet-provider" ? "internet_provider" : "aesthetic_clinic",
              management_mode: "managed",
              preset_id: preset,
            },
          ],
    crm_pipelines: [
      {
        id: PIPELINE,
        organization_id: ORG,
        name: "Vendas — Internet",
        slug: "vendas-internet",
        is_archived: false,
      },
    ],
    crm_stages: ["Plano apresentado", "Aguardando documentos", "Instalação"].map((name, i) => ({
      id: `${i + 8}8888888-8888-4888-8888-888888888888`,
      organization_id: ORG,
      pipeline_id: PIPELINE,
      name,
      is_archived: false,
    })),
    ai_models: [
      {
        provider: "openai",
        model_id: "gpt-test",
        deprecated_at: null,
        supports_tools: true,
        supports_vision: false,
      },
    ],
    ai_provider_credentials_safe: [
      {
        id: CREDENTIAL,
        organization_id: ORG,
        provider: "openai",
        is_active: true,
        validated_at: "2026-01-01",
        models_available: ["gpt-test"],
      },
      {
        id: B_CREDENTIAL,
        organization_id: ORG_B,
        provider: "openai",
        is_active: true,
        validated_at: "2026-01-01",
        models_available: ["gpt-test"],
      },
    ],
    channel_sessions: [
      { id: CHANNEL, organization_id: ORG, status: "WORKING", archived_at: null },
      { id: B_CHANNEL, organization_id: ORG_B, status: "WORKING", archived_at: null },
    ],
    ai_knowledge_sources: [
      { id: KNOWLEDGE, organization_id: ORG, is_active: true },
      { id: B_KNOWLEDGE, organization_id: ORG_B, is_active: true },
    ],
    followup_flow_pointers: [
      { id: FLOW, organization_id: ORG, surface: "atendimento" },
      { id: B_FLOW, organization_id: ORG_B, surface: "atendimento" },
    ],
    ai_agents: [],
    ai_agent_versions: [],
    ai_routers: [],
    ai_router_members: [],
  };
  let writes = 0;
  class Query implements PromiseLike<{
    data: Row[] | null;
    error: null | { code: string; message: string };
  }> {
    filters: Array<(r: Row) => boolean> = [];
    payload: Row | Row[] | null = null;
    constructor(readonly table: string) {}
    select(_columns: string) {
      return this;
    }
    eq(key: string, value: unknown) {
      this.filters.push((r) => r[key] === value);
      return this;
    }
    is(key: string, value: unknown) {
      this.filters.push((r) => r[key] === value);
      return this;
    }
    not(key: string, _op: string, value: unknown) {
      this.filters.push((r) => r[key] !== value);
      return this;
    }
    in(key: string, values: string[]) {
      this.filters.push((r) => values.includes(String(r[key])));
      return this;
    }
    insert(payload: Row | Row[]) {
      this.payload = payload;
      return this;
    }
    result() {
      if (this.payload) {
        const inserted = Array.isArray(this.payload) ? this.payload : [this.payload];
        for (const row of inserted) {
          if (rows[this.table]?.some((r) => r.id === row.id))
            return { data: null, error: { code: "23505", message: "duplicate" } };
          rows[this.table] ??= [];
          rows[this.table]!.push({
            published_version_id: null,
            archived_at: null,
            active_version_id: null,
            ...row,
          });
          writes++;
        }
        return { data: inserted, error: null };
      }
      return {
        data: (rows[this.table] ?? []).filter((r) => this.filters.every((f) => f(r))),
        error: null,
      };
    }
    maybeSingle() {
      const result = this.result();
      return Promise.resolve({ ...result, data: result.data?.[0] ?? null });
    }
    single() {
      return this.maybeSingle();
    }
    then<
      TResult1 = { data: Row[] | null; error: null | { code: string; message: string } },
      TResult2 = never,
    >(
      onfulfilled?:
        | ((value: {
            data: Row[] | null;
            error: null | { code: string; message: string };
          }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      return Promise.resolve(this.result()).then(onfulfilled, onrejected);
    }
  }
  const db = { from: (table: string) => new Query(table) } as unknown as SupabaseClient;
  const audit = vi.fn(async () => undefined);
  return {
    rows,
    db,
    audit,
    writes: () => writes,
    service: createIspAiService({ admin: () => db, audit: audit as never }),
  };
}

describe("pacote ISP 7C", () => {
  it.each(["ordinary", "managed/aesthetic-clinic"])("não alcança %s", async (preset) => {
    const f = fixture(preset);
    const plan = await f.service.preflight(ORG, actor, { ai });
    expect(plan.conflitos).toContain("managed_internet_provider_required");
    expect(f.writes()).toBe(0);
  });

  it("exige platform admin full e vínculo admin atual sem revelar a policy", async () => {
    const f = fixture();
    f.rows.platform_admins![0]!.scope = "support";
    f.rows.user_organizations![0]!.role = "manager";
    const plan = await f.service.preflight(ORG, actor, { ai });
    expect(plan.conflitos).toEqual(["platform_admin_full_required", "agency_membership_required"]);
    expect(plan.a_criar).toEqual([]);
    expect(f.writes()).toBe(0);
  });

  it("preflight só lê; prepare cria cinco mcp_agent em draft e retry não duplica", async () => {
    const f = fixture();
    const before = await f.service.execute(ORG, actor, { ai, confirm: false });
    expect(before.a_criar).toContain("agent:geral");
    expect(f.writes()).toBe(0);
    const first = await f.service.execute(ORG, actor, { ai, confirm: true });
    expect("status" in first && first.status).toBe("prepared");
    expect(f.rows.ai_agents).toHaveLength(5);
    expect(f.rows.ai_agent_versions).toHaveLength(5);
    expect(
      f.rows.ai_agents?.every(
        (a) => a.kind === "mcp_agent" && a.is_active === false && a.published_version_id === null,
      ),
    ).toBe(true);
    expect(
      f.rows.ai_agent_versions?.every(
        (v) => v.status === "draft" && v.cases_enabled === true && v.handoff_tool_enabled === true,
      ),
    ).toBe(true);
    const comercial = f.rows.ai_agent_versions?.find(
      (v) => v.agent_id === ispAiId(ORG, "agent:comercial"),
    );
    expect(comercial?.operator_enabled).toBe(true);
    expect(comercial?.tool_ids).not.toContain("crm_update_lead");
    expect(comercial?.operator_tool_ids).toContain("crm_update_lead");
    expect(
      f.rows.ai_agent_versions
        ?.filter((v) => v.agent_id !== ispAiId(ORG, "agent:comercial"))
        .every((v) => v.operator_enabled === false),
    ).toBe(true);
    expect(f.rows.ai_routers).toHaveLength(0);
    const writes = f.writes();
    const retry = await f.service.execute(ORG, actor, { ai, confirm: true });
    expect("status" in retry && retry.status).toBe("already_prepared");
    expect(f.writes()).toBe(writes);
  });

  it("personalização do prompt vira conflito e preserva o texto", async () => {
    const f = fixture();
    await f.service.execute(ORG, actor, { ai, confirm: true });
    const version = f.rows.ai_agent_versions![0]!;
    version.system_prompt = "Texto personalizado pelo cliente";
    const writes = f.writes();
    const plan = await f.service.preflight(ORG, actor, { ai });
    expect(plan.conflitos).toContain("version:geral_conflict");
    await expect(f.service.execute(ORG, actor, { ai, confirm: true })).rejects.toThrow(
      "managed_isp_ai_denied",
    );
    expect(version.system_prompt).toBe("Texto personalizado pelo cliente");
    expect(f.writes()).toBe(writes);
  });

  it("router inativo mantém quatro intents e fallback, sem duplicar membro no retry", async () => {
    const f = fixture();
    const configured = { ...ai, channel_session_id: CHANNEL };
    await f.service.execute(ORG, actor, { ai: configured, confirm: true });
    expect(f.rows.ai_routers).toHaveLength(1);
    expect(f.rows.ai_routers?.[0]).toMatchObject({
      is_active: false,
      config: {},
      fallback_agent_id: ispAiId(ORG, "agent:geral"),
    });
    expect(f.rows.ai_router_members).toHaveLength(4);
    expect(f.rows.ai_router_members?.map((m) => m.intent_name)).toEqual(
      ISP_AI_INTENTS.map((i) => i.intent_name),
    );
    const writes = f.writes();
    await f.service.execute(ORG, actor, { ai: configured, confirm: true });
    expect(f.writes()).toBe(writes);
    f.rows.ai_router_members![0]!.intent_description = "Mudou";
    expect((await f.service.preflight(ORG, actor, { ai: configured })).conflitos).toContain(
      "member:comercial_conflict",
    );
  });

  it("não prepara segundo roteador sobre um canal já ativo", async () => {
    const f = fixture();
    f.rows.ai_routers!.push({
      id: FLOW,
      organization_id: ORG,
      channel_session_id: CHANNEL,
      is_active: true,
    });
    const plan = await f.service.preflight(ORG, actor, {
      ai: { ...ai, channel_session_id: CHANNEL },
    });
    expect(plan.conflitos).toContain("active_router_on_channel");
    expect(f.writes()).toBe(0);
  });

  it.each([
    [{ ...ai, provider: "unknown" }, "provider_model_credential_invalid"],
    [{ ...ai, model: "unknown" }, "provider_model_credential_invalid"],
    [{ ...ai, credential_id: B_CREDENTIAL }, "provider_model_credential_invalid"],
    [{ ...ai, channel_session_id: B_CHANNEL }, "channel_session_not_in_tenant"],
    [{ ...ai, knowledge_source_ids: [B_KNOWLEDGE] }, "knowledge_source_not_in_tenant"],
    [{ ...ai, flow_pointer_ids: { comercial: B_FLOW } }, "flow_pointer_not_in_tenant:comercial"],
  ])("referência inválida falha fechada", async (bad, conflict) => {
    const f = fixture();
    const plan = await f.service.preflight(ORG, actor, { ai: bad });
    expect(plan.conflitos).toContain(conflict);
    expect(f.writes()).toBe(0);
  });

  it("follow-ups exigem prazos explícitos e nascem internos, draft, sem agente/canal", async () => {
    const f = fixture();
    const empty = await f.service.preflight(ORG, actor, {});
    expect(empty.pendencias).toContain("followup_timing_required:plano_apresentado");
    const timing = { plano_apresentado: { wait_minutes: 600, task_due_days: 2 } };
    await f.service.execute(ORG, actor, { followups: timing, confirm: true });
    const flow = f.rows.followup_flow_pointers!.find(
      (r) => r.id === ispAiId(ORG, "followup:plano_apresentado"),
    )!;
    expect(flow).toMatchObject({
      status: "draft",
      active_version_id: null,
      trigger_config: { kind: "stage_change", cancel_on_reply: true },
    });
    expect(
      (flow.draft_graph as { settings: { somente_interno: boolean } }).settings.somente_interno,
    ).toBe(true);
    expect(f.rows.ai_agents).toHaveLength(0);
  });

  it("papéis não ganham ferramentas falsas de billing, rede ou agenda", () => {
    for (const [role, spec] of Object.entries(ISP_AI_ROLES)) {
      expect(spec.prompt).toContain("Não invente preço");
      expect(
        spec.tools.some((id) => /agenda|calendar|invoice|payment|pix|olt|onu|radius/i.test(id)),
      ).toBe(false);
      if (role === "financeiro") expect(spec.prompt).toContain("Não gere boleto ou PIX");
      if (role === "instalacao") expect(spec.prompt).toContain("não marque no calendário genérico");
    }
  });

  it("o classificador e a decisão canônicos escolhem quatro papéis e a reserva", () => {
    const router: LoadedRouter = {
      id: ispAiId(ORG, "router"),
      name: "ISP · Intent Router",
      classifierModel: null,
      classifierProvider: null,
      sticky: true,
      minConfidence: 0.6,
      fallbackAgentId: ispAiId(ORG, "agent:geral"),
      members: ISP_AI_INTENTS.map((intent) => ({
        agentId: ispAiId(ORG, `agent:${intent.role}`),
        intentName: intent.intent_name,
        intentDescription: intent.intent_description,
        examples: [...intent.examples],
        flowPointerId: null,
      })),
    };
    for (const [message, intentName] of [
      ["Quero contratar internet", "comercial"],
      ["Tem cobertura no meu CEP?", "comercial"],
      ["Minha internet caiu", "suporte"],
      ["Me manda a segunda via", "financeiro"],
      ["Já paguei, libera minha internet", "financeiro"],
      ["Quando o técnico vem?", "instalacao"],
    ]) {
      expect(router.members.find((m) => m.intentName === intentName)?.examples).toContain(message);
      const verdict = parseIntentVerdict(
        JSON.stringify({ intent: intentName, confidence: 0.9 }),
        router.members,
      );
      const decision = destinoDoVeredito(router, undefined, null, verdict);
      expect(decision.membro?.agentId).toBe(ispAiId(ORG, `agent:${intentName}`));
    }
    expect(
      destinoDoVeredito(router, undefined, null, { intentName: "suporte", confidence: 0.2 }).membro,
    ).toBeNull();
    expect(destinoDoVeredito(router, undefined, null, null)).toMatchObject({
      outcome: "classifier_failed",
      membro: null,
    });
    expect(router.fallbackAgentId).toBe(ispAiId(ORG, "agent:geral"));
  });
});
