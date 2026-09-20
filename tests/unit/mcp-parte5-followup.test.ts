import { beforeEach, describe, expect, it, vi } from "vitest";

import type { McpContext } from "@/lib/mcp/types";

vi.mock("@/lib/audit", () => ({ audit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/followup/intervencao", () => ({
  pausaEnrollment: vi
    .fn()
    .mockResolvedValue({ ok: true, status_novo: "paused_manual", next_eval_at: null }),
  retomaEnrollment: vi
    .fn()
    .mockResolvedValue({ ok: true, status_novo: "active", next_eval_at: "2026-10-01T12:00:00Z" }),
  adiaEnrollment: vi
    .fn()
    .mockResolvedValue({ ok: true, status_novo: "active", next_eval_at: "2026-10-02T12:00:00Z" }),
  pulaPassoDoEnrollment: vi
    .fn()
    .mockResolvedValue({ ok: true, status_novo: "active", next_eval_at: "2026-10-03T12:00:00Z" }),
}));
vi.mock("@/lib/followup/publish", () => ({
  publishFollowupFlowVersion: vi
    .fn()
    .mockResolvedValue({ ok: true, version_id: "aaaaaaaa-9999-4999-8999-999999999999" }),
}));

const tools = await import("@/lib/mcp/tools/followup-administracao");
const interventions = await import("@/lib/followup/intervencao");
const publisher = await import("@/lib/followup/publish");

const ORG = "aaaaaaaa-1111-4111-8111-111111111111";
const USER = "aaaaaaaa-2222-4222-8222-222222222222";
const FLOW = "aaaaaaaa-3333-4333-8333-333333333333";
const ENROLLMENT = "aaaaaaaa-4444-4444-8444-444444444444";

type Query = {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  filters: Record<string, unknown>;
  values?: unknown;
};

function fakeDb(resolve: (query: Query) => { data: unknown; error: unknown }) {
  const calls: Query[] = [];
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
  return { db: { from }, calls };
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

describe("MCP Parte 5 — follow-up administrativo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registra onze tools, sem organization_id público, e cerca publicação/ativação/exclusão", () => {
    expect(tools.FOLLOWUP_ADMIN_MCP_TOOLS).toHaveLength(11);
    expect(new Set(tools.FOLLOWUP_ADMIN_MCP_TOOLS.map((tool) => tool.name)).size).toBe(11);
    for (const tool of tools.FOLLOWUP_ADMIN_MCP_TOOLS) {
      expect(Object.keys(tool.inputSchema), tool.name).not.toContain("organization_id");
    }
    expect(tools.crmPublishFollowupFlow.capabilities).toContain("automation_activation");
    expect(tools.crmSetFollowupFlowActive.capabilities).toContain("automation_activation");
    expect(tools.crmDeleteFollowupFlow.capabilities).toContain("destructive_operations");
  });

  it("CRUD cria rascunho e consulta sempre pelo tenant", async () => {
    const pointer = {
      id: FLOW,
      name: "Retorno",
      status: "draft",
      active_version_id: null,
      draft_graph: null,
    };
    const { db, calls } = fakeDb(() => ({ data: pointer, error: null }));
    const created = (await tools.crmCreateFollowupFlow.handler(
      { name: "Retorno" },
      contexto(db),
    )) as { fluxo: typeof pointer };
    expect(created.fluxo.status).toBe("draft");
    const insert = calls.find((call) => call.op === "insert");
    expect(insert?.values).toMatchObject({ organization_id: ORG, name: "Retorno" });
    await tools.crmGetFollowupFlow.handler({ flow_id: FLOW }, contexto(db));
    expect(calls.find((call) => call.op === "select")?.filters).toMatchObject({
      organization_id: ORG,
      id: FLOW,
    });
  });

  it("preflight sem grafo reprova sem publicar nem executar efeito", async () => {
    const { db } = fakeDb(() => ({
      data: {
        id: FLOW,
        status: "draft",
        active_version_id: null,
        draft_graph: null,
        trigger_config: { kind: "manual" },
      },
      error: null,
    }));
    const preflight = (await tools.crmPreflightFollowupFlow.handler(
      { flow_id: FLOW },
      contexto(db),
    )) as { valid: boolean; errors: Array<{ code: string }> };
    const published = (await tools.crmPublishFollowupFlow.handler(
      { flow_id: FLOW },
      contexto(db),
    )) as { published: boolean };
    expect(preflight.valid).toBe(false);
    expect(preflight.errors).toContainEqual(expect.objectContaining({ code: "draft_missing" }));
    expect(published.published).toBe(false);
    expect(publisher.publishFollowupFlowVersion).not.toHaveBeenCalled();
  });

  it("ativação exige versão publicada e não cria enrollment", async () => {
    const { db, calls } = fakeDb(() => ({
      data: { id: FLOW, status: "draft", active_version_id: null, draft_graph: null },
      error: null,
    }));
    await expect(
      tools.crmSetFollowupFlowActive.handler({ flow_id: FLOW, active: true }, contexto(db)),
    ).rejects.toMatchObject({ status: 422 });
    expect(
      calls.some((call) => call.table === "followup_enrollments" && call.op === "insert"),
    ).toBe(false);
  });

  it("delete completa o CRUD pelo encadeamento oficial e filtra todas as tabelas pelo tenant", async () => {
    const { db, calls } = fakeDb((query) =>
      query.op === "select"
        ? {
            data: { id: FLOW, status: "disabled", active_version_id: null, draft_graph: null },
            error: null,
          }
        : { data: null, error: null },
    );
    const result = await tools.crmDeleteFollowupFlow.handler({ flow_id: FLOW }, contexto(db));
    expect(result).toEqual({ deleted: true, flow_id: FLOW });
    const writes = calls.filter((call) => call.op !== "select");
    expect(writes.map((call) => [call.table, call.op])).toEqual([
      ["followup_enrollments", "delete"],
      ["followup_flow_pointers", "update"],
      ["followup_flow_versions", "delete"],
      ["followup_flow_pointers", "delete"],
    ]);
    expect(writes.every((call) => call.filters.organization_id === ORG)).toBe(true);
    expect(calls.some((call) => call.table === "messages" || call.table === "event_log")).toBe(
      false,
    );
  });

  it.each([
    ["pause", "pausaEnrollment"],
    ["resume", "retomaEnrollment"],
    ["snooze", "adiaEnrollment"],
    ["skip", "pulaPassoDoEnrollment"],
  ] as const)(
    "%s delega ao serviço oficial e não envia diretamente",
    async (action, functionName) => {
      const { db, calls } = fakeDb(() => ({ data: null, error: null }));
      await tools.crmControlFollowupEnrollment.handler(
        {
          enrollment_id: ENROLLMENT,
          action,
          next_eval_at: action === "snooze" ? "2026-10-02T12:00:00Z" : undefined,
          edge_id: action === "skip" ? "saida-1" : undefined,
          reason: undefined,
        },
        contexto(db),
      );
      expect(interventions[functionName]).toHaveBeenCalledOnce();
      expect(calls.some((call) => call.table === "messages" || call.table === "event_log")).toBe(
        false,
      );
    },
  );

  it("cancelamento é tenant-scoped, fecha o relógio e registra o evento sem envio", async () => {
    const { db, calls } = fakeDb((query) => {
      if (query.table === "followup_enrollments" && query.op === "select")
        return { data: { id: ENROLLMENT, status: "active", current_node_id: "n1" }, error: null };
      if (query.table === "followup_enrollments" && query.op === "update")
        return { data: { id: ENROLLMENT, status: "cancelled" }, error: null };
      return { data: null, error: null };
    });
    const result = (await tools.crmControlFollowupEnrollment.handler(
      {
        enrollment_id: ENROLLMENT,
        action: "cancel",
        next_eval_at: undefined,
        edge_id: undefined,
        reason: "pedido humano",
      },
      contexto(db),
    )) as { changed: boolean };
    expect(result.changed).toBe(true);
    const update = calls.find(
      (call) => call.table === "followup_enrollments" && call.op === "update",
    );
    expect(update?.filters).toMatchObject({
      organization_id: ORG,
      id: ENROLLMENT,
      status: "active",
    });
    expect(update?.values).toMatchObject({
      status: "cancelled",
      next_eval_at: null,
      cancel_reason: "pedido humano",
    });
    expect(
      calls.some((call) => call.table === "followup_enrollment_events" && call.op === "insert"),
    ).toBe(true);
    expect(calls.some((call) => call.table === "messages" || call.table === "event_log")).toBe(
      false,
    );
  });

  it("id de outro tenant vira not_found e não sofre intervenção", async () => {
    const { db } = fakeDb(() => ({ data: null, error: null }));
    await expect(
      tools.crmControlFollowupEnrollment.handler(
        {
          enrollment_id: ENROLLMENT,
          action: "cancel",
          next_eval_at: undefined,
          edge_id: undefined,
          reason: undefined,
        },
        contexto(db),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});
