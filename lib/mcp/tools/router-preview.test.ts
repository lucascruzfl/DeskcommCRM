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
const SUPPORT = "55555555-5555-4555-8555-555555555555";
const FINANCE = "66666666-6666-4666-8666-666666666666";
const INSTALLATION = "77777777-7777-4777-8777-777777777777";

function context(agents = [
  { id: GENERAL, name: "Atendimento geral ISP" }, { id: SALES, name: "Comercial ISP" },
  { id: SUPPORT, name: "Suporte ISP" }, { id: FINANCE, name: "Financeiro ISP" },
  { id: INSTALLATION, name: "Instalação ISP" },
]) {
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
      members: [
        { agentId: SALES, intentName: "comercial", intentDescription: "Contratação", examples: [], flowPointerId: null },
        { agentId: SUPPORT, intentName: "suporte", intentDescription: "Suporte", examples: [], flowPointerId: null },
        { agentId: FINANCE, intentName: "financeiro", intentDescription: "Financeiro", examples: [], flowPointerId: null },
        { agentId: INSTALLATION, intentName: "instalacao", intentDescription: "Instalação", examples: [], flowPointerId: null },
      ],
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
    expect(mocks.classify.mock.calls[0]?.[3]).not.toHaveProperty("runModelCall");
    expect(out).toMatchObject({ intent_name: "comercial", agent_id: SALES, is_dry_run: true });
    expect(crmTestAiRouter.redigirParaAuditoria?.({ router_id: ROUTER, message: "segredo fictício" })).toEqual({
      router_id: ROUTER, message_present: true,
    });
    expect(crmTestAiRouter.domain).toBe("routing");
    expect(crmTestAiRouter.requiresRole).toBe("manager");
  });

  it("usa os quatro destinos configurados sem regras ISP na implementação", async () => {
    for (const [intent, message, agentId] of [
      ["comercial", "Quero contratar internet", SALES],
      ["suporte", "Minha internet caiu", SUPPORT],
      ["financeiro", "Me manda a segunda via", FINANCE],
      ["instalacao", "Quando o técnico vem?", INSTALLATION],
    ] as const) {
      mocks.classify.mockResolvedValueOnce({ intentName: intent, confidence: 0.95 });
      const out = await crmTestAiRouter.handler({ router_id: ROUTER, message }, context() as never);
      expect(out).toMatchObject({ intent_name: intent, outcome: "classified", agent_id: agentId, is_dry_run: true });
    }
    expect(mocks.classify).toHaveBeenCalledTimes(4);
  });

  it("baixa confiança e falha do classificador vão para Atendimento geral", async () => {
    const ctx = context();
    for (const [verdict, outcome] of [
      [{ intentName: "comercial", confidence: 0.2 }, "no_match"],
      [null, "classifier_failed"],
    ] as const) {
      mocks.classify.mockResolvedValueOnce(verdict);
      const out = await crmTestAiRouter.handler({ router_id: ROUTER, message: "Mensagem ambígua" }, ctx as never);
      expect(out).toMatchObject({ outcome, agent_id: GENERAL, agent_name: "Atendimento geral ISP" });
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
