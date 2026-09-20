import { beforeEach, describe, expect, it, vi } from "vitest";

import type { McpContext } from "@/lib/mcp/types";

vi.mock("@/lib/audit", () => ({ audit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/webhooks/secrets", () => ({
  encryptRuleActionSecrets: vi.fn(async (_db: unknown, actions: unknown) => actions),
}));
vi.mock("@/lib/routing/channel-policies", () => ({
  loadChannelRoutingSettings: vi.fn().mockResolvedValue({ channels: [], members: [] }),
}));
vi.mock("@/lib/routing/eligibles", () => ({
  loadEligibleAttendants: vi.fn().mockResolvedValue([]),
}));

const tools = await import("@/lib/mcp/tools/automacoes-roteamento");
const secrets = await import("@/lib/webhooks/secrets");
const routing = await import("@/lib/routing/eligibles");
const { crmSetAutomationRuleActive } = await import("@/lib/mcp/tools/operacao");
const { capabilitiesOf } = await import("@/lib/mcp/policy");

const ORG = "aaaaaaaa-1111-4111-8111-111111111111";
const USER = "aaaaaaaa-2222-4222-8222-222222222222";
const RULE = "aaaaaaaa-3333-4333-8333-333333333333";
const CHANNEL = "aaaaaaaa-4444-4444-8444-444444444444";
const MEMBER = "aaaaaaaa-5555-4555-8555-555555555555";
const PIPELINE = "aaaaaaaa-6666-4666-8666-666666666666";
const STAGE = "aaaaaaaa-7777-4777-8777-777777777777";

type Query = {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  filters: Record<string, unknown>;
  values?: unknown;
};

function fakeDb(
  resolve: (query: Query) => { data: unknown; error: unknown },
  rpcResult = { data: { mode: "restricted" }, error: null },
) {
  const calls: Query[] = [];
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  const from = (table: string) => {
    const query: Query = { table, op: "select", filters: {} };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      select: () => chain,
      insert: (values: unknown) => {
        query.op = "insert";
        query.values = values;
        return chain;
      },
      update: (values: unknown) => {
        query.op = "update";
        query.values = values;
        return chain;
      },
      delete: () => {
        query.op = "delete";
        return chain;
      },
      eq: (key: string, value: unknown) => {
        query.filters[key] = value;
        return chain;
      },
      is: (key: string, value: unknown) => {
        query.filters[key] = value;
        return chain;
      },
      in: (key: string, value: unknown) => {
        query.filters[key] = value;
        return chain;
      },
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => {
        calls.push({ ...query, filters: { ...query.filters } });
        return resolve(query);
      },
      single: async () => {
        calls.push({ ...query, filters: { ...query.filters } });
        return resolve(query);
      },
      then: (done: (value: unknown) => unknown) => {
        calls.push({ ...query, filters: { ...query.filters } });
        return Promise.resolve(resolve(query)).then(done);
      },
    };
    return chain;
  };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    rpcs.push({ name, args });
    return rpcResult;
  };
  return { db: { from, rpc }, calls, rpcs };
}

function contexto(db: ReturnType<typeof fakeDb>["db"]): McpContext {
  return {
    organizationId: ORG,
    role: "manager",
    actor: { type: "user", id: USER, role: "manager" },
    apiTokenId: "token-1",
    requestId: "req-1",
    supabase: db as never,
  };
}

const regraBase = {
  id: RULE,
  name: "Boas-vindas",
  is_active: false,
  trigger_event: "lead.created",
  trigger_config: {},
  conditions: [],
  actions: [{ type: "add_tag", config: { tags: ["novo"] } }],
};

describe("MCP Parte 5 — automações", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registra dez tools de automação e cinco de routing, sem ids de organização públicos", () => {
    const automations = tools.AUTOMATION_ROUTING_MCP_TOOLS.filter(
      (tool) => tool.domain === "automations",
    );
    const routingTools = tools.AUTOMATION_ROUTING_MCP_TOOLS.filter(
      (tool) => tool.domain === "routing",
    );
    expect(automations).toHaveLength(10);
    expect(routingTools).toHaveLength(5);
    for (const tool of tools.AUTOMATION_ROUTING_MCP_TOOLS) {
      expect(Object.keys(tool.inputSchema), tool.name).not.toContain("organization_id");
    }
  });

  it("descobre gatilhos e ações diretamente dos vocabulários do motor", async () => {
    const triggers = (await tools.crmDiscoverAutomationTriggers.handler(
      {},
      contexto(fakeDb(() => ({ data: null, error: null })).db),
    )) as { triggers: Array<{ name: string; entity_kind: string }> };
    const actions = (await tools.crmDiscoverAutomationActions.handler(
      {},
      contexto(fakeDb(() => ({ data: null, error: null })).db),
    )) as { actions: Array<{ name: string; effect: string }> };
    expect(triggers.triggers).toContainEqual(
      expect.objectContaining({
        name: "appointment.confirmed",
        entity_kind: "calendar_appointment",
      }),
    );
    expect(actions.actions).toContainEqual(
      expect.objectContaining({ name: "call_webhook", effect: "external_webhook" }),
    );
    expect(actions.actions).toContainEqual(
      expect.objectContaining({ name: "start_message_flow", effect: "external_message_flow" }),
    );
  });

  it("preflight valida referências no tenant e não executa ações", async () => {
    const { db, calls } = fakeDb(() => ({ data: null, error: null }));
    const result = (await tools.crmPreflightAutomationRule.handler(
      {
        name: "Mover",
        trigger_event: "lead.created",
        trigger_config: {},
        conditions: [],
        actions: [
          { type: "create_or_move_lead", config: { pipeline_id: PIPELINE, stage_id: STAGE } },
        ],
      },
      contexto(db),
    )) as { valid: boolean; errors: Array<{ code: string }> };
    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(["pipeline_not_found", "stage_invalid"]),
    );
    expect(
      calls
        .filter((call) => ["crm_pipelines", "crm_stages"].includes(call.table))
        .every((call) => call.filters.organization_id === ORG),
    ).toBe(true);
    expect(calls.some((call) => call.op !== "select")).toBe(false);
  });

  it("cria regra inativa, cifra antes de gravar e nunca devolve secret", async () => {
    vi.mocked(secrets.encryptRuleActionSecrets).mockResolvedValueOnce([
      {
        type: "call_webhook",
        config: { url: "https://example.test/hook", secret_enc: "ciphertext" },
      },
    ]);
    const stored = {
      ...regraBase,
      actions: [
        {
          type: "call_webhook",
          config: { url: "https://example.test/hook", secret_enc: "ciphertext" },
        },
      ],
    };
    const { db, calls } = fakeDb(() => ({ data: stored, error: null }));
    const result = await tools.crmCreateAutomationRule.handler(
      {
        name: "Webhook",
        trigger_event: "lead.created",
        trigger_config: {},
        conditions: [],
        actions: [
          { type: "call_webhook", config: { url: "https://example.test/hook", secret: "segredo" } },
        ],
      },
      contexto(db),
    );
    expect(secrets.encryptRuleActionSecrets).toHaveBeenCalledOnce();
    const insert = calls.find((call) => call.table === "automation_rules" && call.op === "insert");
    expect(insert?.values).toMatchObject({ organization_id: ORG, is_active: false });
    expect(JSON.stringify(result)).not.toContain("segredo");
    expect(JSON.stringify(result)).not.toContain("ciphertext");
  });

  it("consulta e histórico removem secrets/ciphertext recursivamente e respeitam tenant", async () => {
    const secretRule = {
      ...regraBase,
      actions: [
        {
          type: "call_webhook",
          config: { url: "https://example.test", secret: "plain", secret_enc: "cipher" },
        },
      ],
    };
    const { db, calls } = fakeDb(() => ({ data: secretRule, error: null }));
    const result = await tools.crmGetAutomationRule.handler({ automation_id: RULE }, contexto(db));
    expect(JSON.stringify(result)).not.toMatch(/plain|cipher|secret_enc/);
    expect(calls[0]?.filters).toMatchObject({ organization_id: ORG, id: RULE });
  });

  it("simula condições sem gravar, enviar mensagem ou chamar webhook", async () => {
    const { db, calls } = fakeDb(() => ({ data: null, error: null }));
    const result = (await tools.crmSimulateAutomationRule.handler(
      {
        automation_id: undefined,
        conditions: [{ field: "lead.status", op: "eq", value: "open" }],
        actions: [{ type: "add_tag", config: { tags: ["quente"] } }],
        context: { lead: { status: "open" } },
      },
      contexto(db),
    )) as { matched: boolean; side_effects_executed: boolean };
    expect(result).toMatchObject({ matched: true, side_effects_executed: false });
    expect(calls).toHaveLength(0);
  });

  it("id de regra de outro tenant vira not_found", async () => {
    const { db } = fakeDb(() => ({ data: null, error: null }));
    await expect(
      tools.crmGetAutomationRule.handler({ automation_id: RULE }, contexto(db)),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("ativação continua protegida pela capability dedicada", () => {
    expect(
      capabilitiesOf(crmSetAutomationRuleActive as unknown as Parameters<typeof capabilitiesOf>[0]),
    ).toEqual(["automation_activation"]);
  });
});

describe("MCP Parte 5 — routing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("atualiza routing por canal pela RPC atômica oficial", async () => {
    const { db, rpcs } = fakeDb(() => ({ data: null, error: null }));
    await tools.crmUpdateChannelRouting.handler(
      { channel_session_id: CHANNEL, user_ids: [MEMBER], reset: false },
      contexto(db),
    );
    expect(rpcs).toEqual([
      {
        name: "fn_set_channel_routing",
        args: { p_org: ORG, p_channel: CHANNEL, p_users: [MEMBER], p_reset: false },
      },
    ]);
  });

  it("simulação recusa canal de outro tenant antes de calcular candidatos", async () => {
    const { db } = fakeDb((query) =>
      query.table === "organizations"
        ? { data: { settings: { routing: { mode: "round_robin" } } }, error: null }
        : { data: null, error: null },
    );
    await expect(
      tools.crmSimulateRouting.handler(
        {
          channel_session_id: CHANNEL,
          already_assigned: false,
          attempts: 0,
          now: "2026-10-01T12:00:00Z",
        },
        contexto(db),
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(routing.loadEligibleAttendants).not.toHaveBeenCalled();
  });

  it("modo manual não atribui e a simulação não produz side effects", async () => {
    const { db } = fakeDb((query) =>
      query.table === "organizations"
        ? { data: { settings: { routing: { mode: "manual" } } }, error: null }
        : { data: { id: CHANNEL }, error: null },
    );
    const result = (await tools.crmSimulateRouting.handler(
      {
        channel_session_id: CHANNEL,
        already_assigned: false,
        attempts: 0,
        now: "2026-10-01T12:00:00Z",
      },
      contexto(db),
    )) as { decision: { kind: string; reason: string }; side_effects_executed: boolean };
    expect(result).toMatchObject({
      decision: { kind: "skip", reason: "manual_mode" },
      side_effects_executed: false,
    });
  });

  it("round_robin escolhe o elegível mais antigo sem alterar estado", async () => {
    vi.mocked(routing.loadEligibleAttendants).mockResolvedValueOnce([
      { userId: "b", currentLoad: 1, lastAssignedAt: 200 },
      { userId: "a", currentLoad: 2, lastAssignedAt: null },
    ]);
    const { db, calls } = fakeDb((query) =>
      query.table === "organizations"
        ? { data: { settings: { routing: { mode: "round_robin" } } }, error: null }
        : { data: { id: CHANNEL }, error: null },
    );
    const result = (await tools.crmSimulateRouting.handler(
      {
        channel_session_id: CHANNEL,
        already_assigned: false,
        attempts: 0,
        now: "2026-10-01T12:00:00Z",
      },
      contexto(db),
    )) as {
      decision: { kind: string; userId: string };
      destination: { user_id: string };
      side_effects_executed: boolean;
    };
    expect(result).toMatchObject({
      decision: { kind: "assign", userId: "a" },
      destination: { user_id: "a" },
      side_effects_executed: false,
    });
    expect(calls.every((call) => call.op === "select")).toBe(true);
  });
});
