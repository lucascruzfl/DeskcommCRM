import { beforeEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({
  create: vi.fn(async () => ({ agent: { id: "agent-1" }, version: { id: "version-1" } })),
  updateVersion: vi.fn(async () => ({ id: "version-1" })),
  publish: vi.fn(async () => ({ ok: true, version_id: "version-1" })),
  test: vi.fn(async () => ({
    run_id: "run-1",
    status: "ok",
    final_text: "Resposta simulada",
    tool_calls: [{ tool: "crm_update_lead", arguments: { stage: "qualified" } }],
  })),
  state: vi.fn(async () => ({ id: "agent-1" })),
}));

vi.mock("@/lib/ai/mcp-service", () => ({
  MCP_AGENT_COLUMNS: "id",
  MCP_VERSION_COLUMNS: "id",
  createAiAgent: service.create,
  createAiAgentVersion: vi.fn(),
  duplicateAgentWithVersion: vi.fn(),
  getAiCredential: vi.fn(),
  getAiModel: vi.fn(),
  getAiProvider: vi.fn(),
  listAiCredentials: vi.fn(),
  listAiModels: vi.fn(),
  listAiProviders: vi.fn(),
  publishAiAgentVersion: service.publish,
  setAiAgentState: service.state,
  testAiAgentVersion: service.test,
  updateAiAgent: vi.fn(),
  updateAiAgentVersion: service.updateVersion,
  validateAiConfiguration: vi.fn(),
  validateVersionForMcp: vi.fn(),
}));

import { AI_MCP_TOOLS } from "@/lib/mcp/tools/ia";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ctx = { organizationId: ORG, provisionedByUserId: USER, actor: { id: "token" }, supabase: {} };

function handler(name: string) {
  const tool = AI_MCP_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`tool ausente: ${name}`);
  return tool.handler as (input: Record<string, unknown>, context: unknown) => Promise<unknown>;
}

function tenantDb(rows: Record<string, Array<Record<string, unknown>>>) {
  const filters: Array<[string, string, unknown]> = [];
  return {
    filters,
    from(table: string) {
      let current = [...(rows[table] ?? [])];
      const builder = {
        select: () => builder,
        eq(column: string, value: unknown) {
          filters.push([table, column, value]);
          current = current.filter((row) => row[column] === value);
          return builder;
        },
        is(column: string, value: unknown) {
          current = current.filter((row) => row[column] === value);
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        async maybeSingle() { return { data: current[0] ?? null, error: null }; },
      };
      return builder;
    },
  };
}

describe("administração MCP de agentes", () => {
  beforeEach(() => vi.clearAllMocks());
  it("cria agente no tenant e atribui autoria ao provisionador humano", async () => {
    await handler("crm_create_ai_agent")({ name: "Comercial", version: {} }, ctx);
    expect(service.create).toHaveBeenCalledWith({}, ORG, USER, { name: "Comercial", version: {} });
  });

  it("edita somente o draft identificado dentro do tenant", async () => {
    await handler("crm_update_ai_agent_version")({ agent_id: "agent-1", version_id: "version-1", patch: { model: "gpt-test" } }, ctx);
    expect(service.updateVersion).toHaveBeenCalledWith({}, ORG, "agent-1", "version-1", { model: "gpt-test" });
  });

  it("publica sem ativar implicitamente e preserva a organização", async () => {
    await handler("crm_publish_ai_agent_version")({ agent_id: "agent-1", version_id: "version-1" }, ctx);
    expect(service.publish).toHaveBeenCalledWith({}, ORG, "agent-1", "version-1");
    expect(service.state).not.toHaveBeenCalled();
  });

  it("ativação é uma chamada separada da publicação", async () => {
    await handler("crm_activate_ai_agent")({ agent_id: "agent-1" }, ctx);
    expect(service.state).toHaveBeenCalledWith({}, ORG, "agent-1", "active");
  });

  it("teste controlado delega ao sandbox e não publica, ativa nem cria agente", async () => {
    const result = await handler("crm_test_ai_agent_version")({
      agent_id: "agent-1",
      version_id: "version-1",
      sample_message: "Olá",
      sample_contact: { name: "Cenário" },
    }, ctx);
    expect(service.test).toHaveBeenCalledWith({}, ORG, "agent-1", "version-1", {
      sample_message: "Olá",
      sample_contact: { name: "Cenário" },
    });
    expect(result).toMatchObject({ run_id: "run-1", tool_calls: [{ tool: "crm_update_lead" }] });
    expect(service.create).not.toHaveBeenCalled();
    expect(service.publish).not.toHaveBeenCalled();
    expect(service.state).not.toHaveBeenCalled();
  });

  it("nega agente, versão e run de outra organização", async () => {
    const db = tenantDb({
      ai_agents: [{ id: "agent-1", organization_id: OTHER_ORG, kind: "mcp_agent" }],
      ai_agent_versions: [{ id: "version-1", agent_id: "agent-1", organization_id: OTHER_ORG }],
      llm_calls: [{ id: "run-1", agent_id: "agent-1", organization_id: OTHER_ORG, purpose: "agent_turn" }],
    });
    const tenantCtx = { ...ctx, supabase: db };

    await expect(handler("crm_get_ai_agent")({ agent_id: "agent-1" }, tenantCtx))
      .rejects.toMatchObject({ code: "not_found" });
    await expect(handler("crm_get_ai_agent_version")({ agent_id: "agent-1", version_id: "version-1" }, tenantCtx))
      .rejects.toMatchObject({ code: "not_found" });
    await expect(handler("crm_get_ai_agent_run")({ run_id: "run-1" }, tenantCtx))
      .rejects.toMatchObject({ code: "not_found" });

    expect(db.filters.filter(([, column]) => column === "organization_id"))
      .toEqual([
        ["ai_agents", "organization_id", ORG],
        ["ai_agent_versions", "organization_id", ORG],
        ["llm_calls", "organization_id", ORG],
      ]);
  });
});
