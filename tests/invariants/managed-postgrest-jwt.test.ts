import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { createServer as createHttpServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildManagedAreaPolicy } from "@/lib/managed-clients/policy";
import { sql } from "./gov-helpers";

const fixture = {
  orgA: randomUUID(),
  orgB: randomUUID(),
  clientA: randomUUID(),
  clientB: randomUUID(),
  manager: randomUUID(),
  operator: randomUUID(),
  channelA: randomUUID(),
  phoneA: randomUUID(),
  calendarA: randomUUID(),
  contactA: randomUUID(),
  conversationA: randomUUID(),
  messageA: randomUUID(),
};
const name = `deskcomm-managed-postgrest-${process.pid}`;
const secret = "deskcomm-managed-postgrest-fixture-only-2026";
let port = 0;
let gateway: Server | null = null;

function jwt(sub: string | undefined, role = "authenticated"): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub, role, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const selected = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(selected));
    });
  });
}

async function getRows(
  sub: string,
  path: string,
): Promise<{ status: number; rows: Record<string, unknown>[] }> {
  const response = await fetch(`http://127.0.0.1:${port}/${path}`, {
    headers: { Authorization: `Bearer ${jwt(sub)}` },
  });
  const body: unknown = await response.json();
  return {
    status: response.status,
    rows: Array.isArray(body) ? (body as Record<string, unknown>[]) : [],
  };
}

async function postRpc(sub: string, name: string, body: object): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/rpc/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt(sub)}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const areas = JSON.stringify(buildManagedAreaPolicy("managed/aesthetic-clinic").areas);
  sql(`
    insert into auth.users(id, email) values
      ('${fixture.clientA}', 'jwt-client-a@invariant.test'),
      ('${fixture.clientB}', 'jwt-client-b@invariant.test'),
      ('${fixture.manager}', 'jwt-manager@invariant.test'),
      ('${fixture.operator}', 'jwt-operator@invariant.test');
    insert into public.organizations(id, slug, legal_name, display_name, settings, onboarding_state) values
      ('${fixture.orgA}', '${fixture.orgA}', 'Clínica A', 'Clínica A',
       '{"admin_secret":"never-expose","canonical_conversation_tags":["atendimento",{"internal":"never-expose"}],"tags":[{"tag":"vip","cor":"#112233","internal":"never-expose"}],"agenda":{"confirmation_delay_minutes":10,"internal":"never-expose"}}'::jsonb,
       '{"internal":"never-expose"}'::jsonb),
      ('${fixture.orgB}', '${fixture.orgB}', 'Clínica B', 'Clínica B', '{}'::jsonb, '{}'::jsonb);
    insert into public.user_organizations(organization_id, user_id, role, accepted_at) values
      ('${fixture.orgA}', '${fixture.clientA}', 'agent', now()),
      ('${fixture.orgB}', '${fixture.clientB}', 'agent', now()),
      ('${fixture.orgA}', '${fixture.manager}', 'admin', now()),
      ('${fixture.orgA}', '${fixture.operator}', 'manager', now());
    insert into public.managed_client_policies(organization_id, business_type, management_mode, preset_id, preset_version, areas, applied_by)
      values ('${fixture.orgA}', 'aesthetic_clinic', 'managed', 'managed/aesthetic-clinic', '1.0.0', '${areas}'::jsonb, '${fixture.manager}');
    insert into public.channel_sessions(id, organization_id, waha_session_name, webhook_secret_encrypted)
      values ('${fixture.channelA}', '${fixture.orgA}', 'jwt-test-a', '\\x00'::bytea);
    insert into public.contacts(id,organization_id,name,phone_number) values
      ('${fixture.contactA}','${fixture.orgA}','Paciente fixture','+5511000000001');
    insert into public.conversations(id,organization_id,contact_id,channel_session_id,metadata) values
      ('${fixture.conversationA}','${fixture.orgA}','${fixture.contactA}','${fixture.channelA}','{"internal":"never-expose"}');
    insert into public.messages(id,organization_id,conversation_id,channel_session_id,contact_id,type,direction,body,sent_via,metadata) values
      ('${fixture.messageA}','${fixture.orgA}','${fixture.conversationA}','${fixture.channelA}','${fixture.contactA}',
       'text','inbound','Mensagem operacional','external_device','{"agent_id":"never-expose","citations":[{"snippet":"never-expose"}],"ai_generated":true}');
    insert into public.phone_numbers(id, organization_id, number, trunk_endpoint)
      values ('${fixture.phoneA}', '${fixture.orgA}', '+5511000000000', 'sip:never-expose');
    insert into public.calendar_connections(id, organization_id, user_id, account_email, status, sync_token)
      values ('${fixture.calendarA}', '${fixture.orgA}', '${fixture.clientA}', 'agenda@invariant.test', 'healthy', 'never-expose');
    insert into public.calendar_connection_calendars(organization_id, connection_id, external_calendar_id, name, sync_token)
      values ('${fixture.orgA}', '${fixture.calendarA}', 'principal', 'Principal', 'never-expose');
    update public.crm_pipelines
      set settings = '{"fields":[{"key":"origem","label":"Origem","type":"text","options":[{"value":"x","label":"X","internal":"never-expose"}],"internal":"never-expose"}],"admin_secret":"never-expose"}'::jsonb,
          vocabulary = '{"lead":"Paciente","deal":{"internal":"never-expose"},"internal":"never-expose"}'::jsonb
      where organization_id = '${fixture.orgA}';
  `);
  port = await freePort();
  execFileSync(
    "docker",
    [
      "run",
      "-d",
      "--rm",
      "--name",
      name,
      "--network",
      "host",
      "--label",
      "deskcomm.harness=managed-postgrest",
      "-e",
      `PGRST_DB_URI=postgres://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT}/postgres`,
      "-e",
      "PGRST_DB_SCHEMAS=public",
      "-e",
      "PGRST_DB_ANON_ROLE=anon",
      "-e",
      `PGRST_JWT_SECRET=${secret}`,
      "-e",
      `PGRST_SERVER_PORT=${port}`,
      "postgrest/postgrest:v12.2.12",
    ],
    { stdio: "ignore" },
  );
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.status < 500) return;
    } catch {
      /* PostgREST ainda iniciando */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("PostgREST descartável não iniciou");
}, 30_000);

afterAll(() => {
  gateway?.close();
  try {
    execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  } catch {
    /* fixture já saiu */
  }
});

async function gatewayPort(): Promise<number> {
  const selected = await freePort();
  gateway = createHttpServer(async (request, response) => {
    try {
      const target = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
      target.pathname = target.pathname.replace(/^\/rest\/v1(?=\/)/, "");
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const upstream = await fetch(target, {
        method: request.method,
        headers: request.headers as HeadersInit,
        body: body.length ? body : undefined,
      });
      response.writeHead(upstream.status, Object.fromEntries(upstream.headers));
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      response.writeHead(502);
      response.end();
    }
  });
  await new Promise<void>((resolve) => gateway!.listen(selected, "127.0.0.1", resolve));
  return selected;
}

describe("PostgREST com JWT persistido na sessão HTTP", () => {
  it.each([
    ["organizations", "operational_organizations", "id"],
    ["channel_sessions", "operational_channel_sessions", "organization_id"],
    ["crm_stages", "operational_crm_stages", "organization_id"],
    ["crm_pipelines", "operational_crm_pipelines", "organization_id"],
    ["conversations", "operational_conversations", "organization_id"],
    ["messages", "operational_messages", "organization_id"],
  ])(
    "%s base nega ao cliente; %s mostra somente o tenant e colunas operacionais",
    async (base, projection, orgKey) => {
      const own = `${orgKey}=eq.${fixture.orgA}&select=*`;
      const foreign = `${orgKey}=eq.${fixture.orgB}&select=*`;
      const clientBase = await getRows(fixture.clientA, `${base}?${own}`);
      const managerBase = await getRows(fixture.manager, `${base}?${own}`);
      const clientView = await getRows(fixture.clientA, `${projection}?${own}`);
      const foreignView = await getRows(fixture.clientA, `${projection}?${foreign}`);
      expect(clientBase).toMatchObject({ status: 200, rows: [] });
      expect(managerBase.status).toBe(200);
      expect(managerBase.rows.length).toBeGreaterThan(0);
      expect(clientView.status).toBe(200);
      expect(clientView.rows.length).toBeGreaterThan(0);
      expect(foreignView).toMatchObject({ status: 200, rows: [] });
      expect(JSON.stringify(clientView.rows)).not.toContain("never-expose");
      const keys = Object.keys(clientView.rows[0] ?? {});
      for (const forbidden of [
        "onboarding_state",
        "created_by",
        "webhook_secret_encrypted",
        "webhook_path_token",
        "waha_session_name",
        "agent_stage_hint",
        "last_change_actor_kind",
      ]) {
        expect(keys).not.toContain(forbidden);
      }
      if (projection === "operational_crm_pipelines") {
        const settings = clientView.rows[0]?.settings as Record<string, unknown>;
        expect(settings).not.toHaveProperty("admin_secret");
        expect(settings.fields).toEqual([
          { key: "origem", label: "Origem", type: "text", options: [{ value: "x", label: "X" }] },
        ]);
        expect(clientView.rows[0]?.vocabulary).not.toHaveProperty("internal");
        expect(JSON.stringify(clientView.rows[0])).not.toContain("never-expose");
      }
    },
  );

  it("escrita operacional não substitui metadado privado nem atravessa tenant", async () => {
    const response = await fetch(
      `http://127.0.0.1:${port}/operational_conversations?id=eq.${fixture.conversationA}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${jwt(fixture.clientA)}`,
          "content-type": "application/json",
          prefer: "return=representation",
        },
        body: JSON.stringify({ tags: ["operacional"] }),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("never-expose");
    expect(
      sql(
        `select metadata->>'internal' from public.conversations where id='${fixture.conversationA}'`,
      ),
    ).toBe("never-expose");
    const foreign = await fetch(
      `http://127.0.0.1:${port}/operational_conversations?id=eq.${fixture.conversationA}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${jwt(fixture.clientB)}`,
          "content-type": "application/json",
          prefer: "return=representation",
        },
        body: JSON.stringify({ tags: ["indevida"] }),
      },
    );
    expect(foreign.status).toBe(200);
    expect(await foreign.json()).toEqual([]);
    const assignment = await postRpc(fixture.clientA, "fn_conversation_assign", {
      p_organization_id: fixture.orgA,
      p_conversation_id: fixture.conversationA,
      p_to_user_id: fixture.clientA,
      p_reason: "claim",
    });
    expect(assignment.status).toBe(200);
    expect(await assignment.text()).not.toContain("never-expose");
    const signal = await getRows(
      fixture.clientA,
      `operational_inbox_signals?organization_id=eq.${fixture.orgA}&select=*`,
    );
    expect(signal.status).toBe(200);
    expect(signal.rows).toHaveLength(1);
    expect(JSON.stringify(signal.rows)).not.toContain("never-expose");
  });

  it("manager sem membership em B não lê nem seleciona B", async () => {
    const result = await getRows(
      fixture.manager,
      `operational_organizations?id=eq.${fixture.orgB}&select=*`,
    );
    expect(result).toMatchObject({ status: 200, rows: [] });
  });

  it("JWT sem membership não lê o funil de A", async () => {
    const result = await getRows(
      randomUUID(),
      `operational_crm_pipelines?organization_id=eq.${fixture.orgA}&select=*`,
    );
    expect(result).toMatchObject({ status: 200, rows: [] });
  });

  it("settings projetado não publica configuração interna", async () => {
    const result = await getRows(
      fixture.clientA,
      `operational_organizations?id=eq.${fixture.orgA}&select=settings`,
    );
    expect(result.status).toBe(200);
    const settings = result.rows[0]?.settings as Record<string, unknown>;
    expect(settings.canonical_conversation_tags).toEqual(["atendimento"]);
    expect(settings).not.toHaveProperty("admin_secret");
    expect(JSON.stringify(settings)).not.toContain("never-expose");
  });

  it("número técnico fica fora do SELECT do agent e RPC de DNIS não é chamável", async () => {
    const base = await getRows(
      fixture.clientA,
      `phone_numbers?organization_id=eq.${fixture.orgA}&select=*`,
    );
    const manager = await getRows(
      fixture.manager,
      `phone_numbers?organization_id=eq.${fixture.orgA}&select=*`,
    );
    expect(base).toMatchObject({ status: 200, rows: [] });
    expect(manager.rows).toHaveLength(1);
    const rpc = await postRpc(fixture.clientA, "fn_resolve_inbound_number", {
      p_number: "+5511000000000",
    });
    expect([403, 404]).toContain(rpc.status);
    expect(await rpc.text()).not.toContain(fixture.orgA);
  });

  it("a própria agenda é visível sem tokens, cursores ou leitura das bases", async () => {
    for (const [base, view] of [
      ["calendar_connections", "operational_calendar_connections"],
      ["calendar_connection_calendars", "operational_calendar_connection_calendars"],
    ]) {
      const baseRows = await getRows(
        fixture.clientA,
        `${base}?organization_id=eq.${fixture.orgA}&select=*`,
      );
      const ownRows = await getRows(
        fixture.clientA,
        `${view}?organization_id=eq.${fixture.orgA}&select=*`,
      );
      const foreignRows = await getRows(
        fixture.clientB,
        `${view}?organization_id=eq.${fixture.orgA}&select=*`,
      );
      expect(baseRows).toMatchObject({ status: 200, rows: [] });
      expect(ownRows.status).toBe(200);
      expect(ownRows.rows).toHaveLength(1);
      expect(foreignRows).toMatchObject({ status: 200, rows: [] });
      expect(JSON.stringify(ownRows.rows)).not.toContain("never-expose");
      for (const secret of [
        "sync_token",
        "sync_cursor",
        "oauth_access_token_encrypted",
        "oauth_refresh_token_encrypted",
      ]) {
        expect(ownRows.rows[0]).not.toHaveProperty(secret);
      }
    }
  });

  it("gestor com membership lê B na projeção operacional", async () => {
    sql(`insert into public.user_organizations(organization_id, user_id, role, accepted_at)
      values ('${fixture.orgB}', '${fixture.manager}', 'admin', now());`);
    const result = await getRows(
      fixture.manager,
      "operational_organizations?select=id,display_name&order=display_name",
    );
    expect(result.status).toBe(200);
    expect(result.rows.map((row) => row.id)).toEqual([fixture.orgA, fixture.orgB]);
  });

  it.each([
    ["retrieve_top_k_chunks", { p_kb_version_id: randomUUID() }],
    ["fn_buscar_trechos_das_fontes", { p_source_ids: [randomUUID()] }],
  ])("%s não contorna a área privada com SECURITY DEFINER", async (name, args) => {
    const body = {
      ...args,
      p_organization_id: fixture.orgA,
      p_embedding: `[${Array.from({ length: 1536 }, () => 0).join(",")}]`,
    };
    const denied = await postRpc(fixture.clientA, name, body);
    expect(denied.status).toBe(403);
    expect(await denied.text()).toContain("managed_area_denied");
    const allowed = await postRpc(fixture.manager, name, body);
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual([]);
    const foreign = await postRpc(fixture.clientB, name, body);
    expect(foreign.status).toBe(403);
  });

  it("emit_event recusa evento administrativo e preserva eventos operacionais", async () => {
    const args = {
      p_entity_kind: "crm_lead",
      p_entity_id: null,
      p_payload: {},
      p_metadata: {},
      p_organization_id: fixture.orgA,
    };
    const denied = await postRpc(fixture.clientA, "emit_event", {
      ...args,
      p_event_type: "knowledge_source.updated",
    });
    expect(denied.status).toBe(403);
    expect(await denied.text()).toContain("managed_event_denied");
    for (const event of [
      "lead.won",
      "lead.reopened",
      "lead.assigned",
      "message.sending",
      "message.outbound",
    ]) {
      const allowed = await postRpc(fixture.clientA, "emit_event", {
        ...args,
        p_event_type: event,
      });
      expect(allowed.status, event).toBe(200);
    }
  });

  it("RPC administrativa nega chamada direta do manager da clínica", async () => {
    const input = { p_org: fixture.orgA, p_channel: fixture.channelA, p_users: [], p_reset: true };
    const denied = await postRpc(fixture.operator, "fn_set_channel_routing", input);
    expect(denied.status).toBe(403);
    const allowed = await postRpc(fixture.manager, "fn_set_channel_routing", input);
    expect(allowed.status).toBe(200);
  });

  it("RPC de configuração não revela nem um bit de outro tenant", async () => {
    const own = await postRpc(fixture.clientA, "fn_colegas_podem_mexer_na_agenda", {
      p_org: fixture.orgA,
    });
    const foreign = await postRpc(fixture.clientA, "fn_colegas_podem_mexer_na_agenda", {
      p_org: fixture.orgB,
    });
    expect(own.status).toBe(200);
    expect(foreign.status).toBe(403);
  });

  it("MCP com token persistido mostra só tools permitidas e nega chamada direta", async () => {
    const persistToken = () => {
      const prefix = `dsk_${randomBytes(4).toString("hex")}`;
      const value = `${prefix}_${randomBytes(32).toString("base64url")}`;
      const hash = createHash("sha256").update(value).digest("hex");
      sql(`insert into public.api_tokens(id, organization_id, created_by, name, prefix, token_hash, scopes)
        values ('${randomUUID()}', '${fixture.orgA}', '${fixture.clientA}', 'fixture managed',
          '${prefix}', decode('${hash}', 'hex'),
          '["mcp:read","mcp:write","capability:send_messages","capability:human_handoff","capability:destructive_operations"]'::jsonb);`);
      return value;
    };
    let token = persistToken();
    const localPort = await gatewayPort();
    process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${localPort}`;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = jwt(fixture.clientA, "anon");
    process.env.SUPABASE_SERVICE_ROLE_KEY = jwt(undefined, "service_role");
    process.env.UPSTASH_REDIS_REST_URL = "";
    process.env.UPSTASH_REDIS_REST_TOKEN = "";
    const { POST } = await import("@/app/api/mcp/route");
    const call = async (id: number, method: string, params: object) => {
      const response = await POST(
        new Request("http://localhost/api/mcp", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        }) as never,
      );
      return { status: response.status, body: await response.text() };
    };
    const handshake = await call(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "fixture", version: "1" },
    });
    expect(handshake.status).toBe(200);
    const listed = await call(2, "tools/list", {});
    expect(listed.status).toBe(200);
    const audited = JSON.parse(readFileSync("docs/security/managed-client-mcp-audit.json", "utf8")) as {
      tools: Array<{name: string; client_allowed: boolean}>;
    };
    const frames = listed.body.trim().startsWith("{") ? [JSON.parse(listed.body)]
      : listed.body.split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
    const names = frames.find(frame => frame.result?.tools)?.result.tools.map((tool: {name: string}) => tool.name) as string[];
    expect(names.sort()).toEqual(audited.tools.filter(tool => tool.client_allowed).map(tool => tool.name).sort());
    const forbidden = audited.tools.filter(tool => !tool.client_allowed);
    expect(forbidden.length).toBeGreaterThan(100);
    for (const [index, tool] of forbidden.entries()) {
      // Cada token é persistido na mesma fixture. Rotação conserva o teto real,
      // sem desativar rate limit para a certificação de autorização.
      if (index > 0 && index % 45 === 0) {
        token = persistToken();
        expect((await call(1000 + index, "initialize", {
          protocolVersion: "2025-06-18", capabilities: {}, clientInfo: {name: "fixture", version: "1"},
        })).status).toBe(200);
      }
      const denied = await call(100 + index, "tools/call", { name: tool.name, arguments: {} });
      expect(denied.status, tool.name).toBe(200);
      expect(denied.body, tool.name).toMatch(/not found|Unknown tool|not_allowed/i);
    }
    for (const [name, args] of [
      ["crm_get_conversation", {conversation_id: fixture.conversationA}],
      ["crm_get_conversation_history", {conversation_id: fixture.conversationA}],
      ["crm_get_message", {message_id: fixture.messageA}],
      ["crm_list_appointments", {contact_id: fixture.contactA}],
    ] as const) {
      const result = await call(900, "tools/call", {name, arguments: args});
      expect(result.status, name).toBe(200);
      expect(result.body, name).not.toContain('"isError":true');
      expect(result.body, name).not.toContain("never-expose");
    }
    const allowed = await call(6, "tools/call", { name: "crm_list_pipelines", arguments: {} });
    expect(allowed.status).toBe(200);
    expect(allowed.body).toContain("Pedidos");
    expect(allowed.body).not.toContain("never-expose");
    const foreignPipeline = sql(
      `select id from public.crm_pipelines where organization_id = '${fixture.orgB}' limit 1;`,
    ).trim();
    const foreign = await call(7, "tools/call", {
      name: "crm_get_pipeline",
      arguments: { pipeline_id: foreignPipeline },
    });
    expect(foreign.body).toMatch(/not_found|Funil não encontrado|isError/i);
    expect(foreign.body).not.toContain(fixture.orgB);
  }, 120_000);
});
