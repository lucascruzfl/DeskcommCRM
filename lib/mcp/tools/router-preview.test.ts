import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  classify: vi.fn(),
  pool: vi.fn(),
}));
vi.mock("@/lib/ai/skills/db", () => ({ getSkillsPool: mocks.pool }));
vi.mock("@/lib/agent-engine/agent/router-config", () => ({ loadRouterForPreview: mocks.load }));
vi.mock("@/lib/agent-engine/agent/intent-classifier", () => ({ classifyIntent: mocks.classify }));
vi.mock("@/lib/agent-engine/edge/llm/credentials", () => ({ llmEdgeConfigFromEnv: () => ({}) }));
vi.mock("@/lib/agent-engine/obs/logger", () => ({ createLogger: () => ({ warn: vi.fn() }) }));
vi.mock("@/lib/env", () => ({ env: {} }));

import { crmGetAiRouter, crmTestAiRouter } from "./router-preview";

const ORG = "11111111-1111-4111-8111-111111111111";
const ROUTER = "22222222-2222-4222-8222-222222222222";
const GENERAL = "33333333-3333-4333-8333-333333333333";
const SALES = "44444444-4444-4444-8444-444444444444";

function context(agents = [{ id: GENERAL, name: "Atendimento geral ISP" }, { id: SALES, name: "Comercial ISP" }]) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ data: agents, error: null }),
  };
  return {
    organizationId: ORG,
    supabase: { from: vi.fn(() => query) },
    query,
  };
}

describe("crm_test_ai_router — prévia do draft via MCP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pool.mockReturnValue({});
    mocks.load.mockResolvedValue({
      id: ROUTER, name: "ISP · Intent Router", classifierModel: null,
      classifierProvider: null, sticky: true, minConfidence: 0.6,
      fallbackAgentId: GENERAL,
      members: [{ agentId: SALES, intentName: "comercial", intentDescription: "Contratação", examples: [], flowPointerId: null }],
    });
  });

  it("usa tenant autenticado, classificador e decisão canônicos sem exigir router ativo", async () => {
    mocks.classify.mockResolvedValue({ intentName: "comercial", confidence: 0.9 });
    const ctx = context();
    const out = await crmTestAiRouter.handler({ router_id: ROUTER, message: "Quero contratar internet" }, ctx as never);
    expect(mocks.load).toHaveBeenCalledWith(expect.anything(), ORG, ROUTER);
    expect(ctx.query.eq).toHaveBeenCalledWith("organization_id", ORG);
    expect(mocks.classify).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      tenantId: ORG, leadId: null, jobId: null, signal: "Quero contratar internet",
    }), expect.anything());
    expect(out).toMatchObject({ intent_name: "comercial", agent_id: SALES, is_dry_run: true });
    expect(crmTestAiRouter.redigirParaAuditoria?.({ router_id: ROUTER, message: "segredo fictício" })).toEqual({
      router_id: ROUTER, message_present: true,
    });
    expect(crmTestAiRouter.domain).toBe("routing");
    expect(crmTestAiRouter.requiresRole).toBe("manager");
  });

  it("baixa confiança e falha do classificador vão para Atendimento geral", async () => {
    const ctx = context();
    for (const verdict of [{ intentName: "comercial", confidence: 0.2 }, null]) {
      mocks.classify.mockResolvedValueOnce(verdict);
      const out = await crmTestAiRouter.handler({ router_id: ROUTER, message: "Mensagem ambígua" }, ctx as never);
      expect(out).toMatchObject({ agent_id: GENERAL, agent_name: "Atendimento geral ISP" });
    }
  });

  it("falha fechado para router e agente de outro tenant", async () => {
    const ctx = context();
    mocks.load.mockResolvedValueOnce(null);
    await expect(crmTestAiRouter.handler({ router_id: ROUTER, message: "teste" }, ctx as never)).rejects.toThrow("router_not_found");
    const other = context([{ id: GENERAL, name: "Geral" }]);
    await expect(crmTestAiRouter.handler({ router_id: ROUTER, message: "teste" }, other as never)).rejects.toThrow("router_agent_not_in_tenant");
    expect(mocks.classify).not.toHaveBeenCalled();
  });
});

describe("crm_get_ai_router — inspeção tenant-scoped", () => {
  it("lê router e membros somente da organização do token", async () => {
    const routerQuery = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: ROUTER, is_active: false }, error: null }),
    };
    const membersQuery = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [{ intent_name: "comercial" }], error: null }),
    };
    const supabase = { from: vi.fn((table: string) => table === "ai_routers" ? routerQuery : membersQuery) };
    const result = await crmGetAiRouter.handler({ router_id: ROUTER }, { organizationId: ORG, supabase } as never);
    expect(result).toMatchObject({ router: { is_active: false }, members: [{ intent_name: "comercial" }] });
    expect(routerQuery.eq).toHaveBeenCalledWith("organization_id", ORG);
    expect(membersQuery.eq).toHaveBeenCalledWith("organization_id", ORG);
    expect(membersQuery.eq).toHaveBeenCalledWith("router_id", ROUTER);
  });

  it("recusa router de outro tenant antes de ler membros", async () => {
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const supabase = { from: vi.fn(() => query) };
    await expect(crmGetAiRouter.handler({ router_id: ROUTER }, { organizationId: ORG, supabase } as never))
      .rejects.toThrow("router_not_found");
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });
});
