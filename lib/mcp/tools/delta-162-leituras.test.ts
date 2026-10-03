import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import type * as EmbedModule from "@/lib/ai/embed";
const mocks = vi.hoisted(() => ({
  embed: vi.fn(),
  listGroups: vi.fn(),
  setIntake: vi.fn(),
  rate: vi.fn(),
  db: {} as unknown,
}));
vi.mock("@/lib/ai/embed", async (original) => ({
  ...(await original<typeof EmbedModule>()),
  embedText: mocks.embed,
}));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: mocks.rate }));
vi.mock("@/lib/channels/session-ref", () => ({
  CHANNEL_SESSION_REF_COLUMNS: "id,provider",
  resolveSessionRef: (ref: { id: string }) => ref.id,
}));
vi.mock("@/lib/channels", () => ({
  capabilitiesOf: () => ({ groups: "full" }),
  getAdapter: () => ({ listGroups: mocks.listGroups, setGroupIntake: mocks.setIntake }),
}));
import {
  crmListChannelGroups,
  crmSearchOrganizationKnowledge,
  DELTA_162_READ_TOOLS,
} from "./delta-162-leituras";
import { MCP_REGISTRY } from "@/lib/mcp/registry";
import { authorizeTool, domainScope, managedAreaOfTool } from "@/lib/mcp/policy";
import { ensureRole } from "@/lib/mcp/auth";
import { catalogEntry } from "./catalog";
import type { McpContext } from "../types";
const org = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const id = "20000000-0000-4000-8000-000000000001";
const foreign = "20000000-0000-4000-8000-000000000002";
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let inserted: Row[];
let rpc: ReturnType<typeof vi.fn>;
function database() {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let payload: Row | undefined;
      const result = () => {
        if (payload) {
          inserted.push(payload);
          return { data: null, error: null };
        }
        return {
          data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))),
          error: null,
        };
      };
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => {
          filters.push((r) => r[k] === v);
          return q;
        },
        insert: (p: Row) => {
          payload = p;
          return q;
        },
        maybeSingle: async () => {
          const r = result();
          return { ...r, data: r.data?.[0] ?? null };
        },
        then: (resolve: (r: ReturnType<typeof result>) => unknown) =>
          Promise.resolve(result()).then(resolve),
      };
      return q;
    },
    rpc,
  };
}
const ctx = (): McpContext => ({
  organizationId: org,
  role: "manager",
  apiTokenId: id,
  actor: { type: "api_token", id },
  requestId: "delta",
  supabase: mocks.db as McpContext["supabase"],
});
beforeEach(() => {
  vi.clearAllMocks();
  inserted = [];
  mocks.embed.mockResolvedValue({ embedding: [0.1], model: "tenant-embedding" });
  mocks.listGroups.mockResolvedValue([{ chatId: "123@g.us", subject: "Grupo" }]);
  mocks.rate.mockResolvedValue({ allowed: true });
  rpc = vi.fn(async () => ({
    data: [
      {
        chunk_id: id,
        knowledge_source_id: id,
        source_name: "Material",
        content: "Trecho",
        similarity: 0.7,
      },
    ],
    error: null,
  }));
  tables = {
    channel_sessions: [
      { id, organization_id: org, provider: "test-channel" },
      {
        id: foreign,
        organization_id: other,
        provider: "test-channel",
      },
    ],
    channel_session_groups: [
      {
        organization_id: org,
        channel_session_id: id,
        group_chat_id: "456@g.us",
        enabled: true,
        subject: "Órfão",
        enabled_at: "2026-10-01",
      },
      {
        organization_id: other,
        channel_session_id: id,
        group_chat_id: "789@g.us",
        enabled: true,
        subject: "Sigilo",
      },
    ],
    ai_knowledge_sources: [
      { id, organization_id: org, is_active: true },
      { id: foreign, organization_id: other, is_active: true },
    ],
    ai_agents: [
      {
        id,
        organization_id: org,
        published_version_id: id,
        config: { rag_similarity_threshold: 0.8 },
      },
      { id: foreign, organization_id: other, published_version_id: foreign },
    ],
    ai_agent_versions: [{ id, organization_id: org, knowledge_source_ids: [id] }],
  };
  mocks.db = database();
});
it.each(DELTA_162_READ_TOOLS)("$name: registry, catálogo, role e scopes explícitos", (tool) => {
  expect(MCP_REGISTRY.find((t) => t.name === tool.name)).toBe(tool);
  expect(catalogEntry(tool.name)?.apenasHumano).toBe(true);
  expect(() => ensureRole("agent", tool.requiresRole)).toThrow();
  expect(() => authorizeTool({ ...ctx(), scopes: ["mcp:read", "contacts:read"] }, tool)).toThrow(
    "scope_missing",
  );
  expect(domainScope(tool)).toBe(`${tool.domain}:read`);
  expect(managedAreaOfTool(tool)).toBe(
    tool.name === crmListChannelGroups.name ? "/app/connections" : "/app/ai/knowledge/sources",
  );
  expect(
    JSON.stringify(
      tool.redigirParaAuditoria?.({ pergunta: "SIGILO", channel_session_id: "SIGILO" }),
    ),
  ).not.toContain("SIGILO");
  expect(tool.redigirErroParaAuditoria?.("SIGILO")).not.toContain("SIGILO");
});
it("grupos mantém presentes/órfãos, não altera intake e recusa sessão estrangeira antes do provider", async () => {
  expect(await crmListChannelGroups.handler({ channel_session_id: id }, ctx())).toMatchObject({
    groups: [
      { chatId: "123@g.us", presente: true },
      { chatId: "456@g.us", presente: false },
    ],
  });
  expect(mocks.listGroups).toHaveBeenCalledWith({ sessionRef: id });
  expect(mocks.setIntake).not.toHaveBeenCalled();
  mocks.listGroups.mockClear();
  await expect(
    crmListChannelGroups.handler({ channel_session_id: foreign }, ctx()),
  ).rejects.toThrow("sessao_nao_encontrada");
  expect(mocks.listGroups).not.toHaveBeenCalled();
  await expect(
    crmListChannelGroups.handler({ channel_session_id: "invalid" }, ctx()),
  ).rejects.toBeInstanceOf(z.ZodError);
});
it("acervo org usa fontes do tenant, embedding e telemetria sem pergunta nem identidade humana falsa", async () => {
  expect(
    await crmSearchOrganizationKnowledge.handler(
      { pergunta: "pergunta sigilosa", quantidade: 6 },
      ctx(),
    ),
  ).toMatchObject({ trechos: [{ content: "Trecho" }], acervo: { fontes: 1, limiar: 0.4 } });
  expect(rpc).toHaveBeenCalledWith(
    "fn_buscar_trechos_das_fontes",
    expect.objectContaining({
      p_organization_id: org,
      p_source_ids: [id],
      p_embedding_model: "tenant-embedding",
    }),
  );
  expect(inserted).toEqual([
    expect.objectContaining({
      organization_id: org,
      author_kind: "ai",
      author_user_id: null,
      agent_id: null,
    }),
  ]);
  expect(JSON.stringify(inserted)).not.toContain("sigilosa");
});
it("acervo de agente usa limiar canônico e distingue quase achou; estrangeiro não consulta", async () => {
  expect(
    await crmSearchOrganizationKnowledge.handler(
      { pergunta: "pergunta", quantidade: 6, agent_id: id },
      ctx(),
    ),
  ).toMatchObject({ trechos: [], melhorSimilaridade: 0.7, acervo: { fontes: 1, limiar: 0.8 } });
  rpc.mockClear();
  mocks.embed.mockClear();
  expect(
    await crmSearchOrganizationKnowledge.handler(
      { pergunta: "pergunta", quantidade: 6, agent_id: foreign },
      ctx(),
    ),
  ).toMatchObject({ trechos: [], acervo: { fontes: 0 } });
  expect(rpc).not.toHaveBeenCalled();
  expect(mocks.embed).not.toHaveBeenCalled();
});
it("limite de consultas e input inválido não gastam embedding", async () => {
  mocks.rate.mockResolvedValue({ allowed: false });
  await expect(
    crmSearchOrganizationKnowledge.handler({ pergunta: "pergunta", quantidade: 6 }, ctx()),
  ).rejects.toThrow("rate_limited");
  expect(mocks.embed).not.toHaveBeenCalled();
  await expect(
    crmSearchOrganizationKnowledge.handler({ pergunta: "x".repeat(1001), quantidade: 6 }, ctx()),
  ).rejects.toBeInstanceOf(z.ZodError);
});
it("acervo vazio não gasta embedding e erro de embedding preserva recusa", async () => {
  tables.ai_knowledge_sources = [];
  expect(
    await crmSearchOrganizationKnowledge.handler({ pergunta: "pergunta", quantidade: 6 }, ctx()),
  ).toMatchObject({ trechos: [], acervo: { fontes: 0 } });
  expect(mocks.embed).not.toHaveBeenCalled();
  tables.ai_knowledge_sources = [{ id, organization_id: org, is_active: true }];
  mocks.embed.mockRejectedValue(new Error("segredo do provedor"));
  await expect(
    crmSearchOrganizationKnowledge.handler({ pergunta: "pergunta", quantidade: 6 }, ctx()),
  ).rejects.toMatchObject({ code: "internal_error" });
  expect(inserted).toEqual([]);
});
