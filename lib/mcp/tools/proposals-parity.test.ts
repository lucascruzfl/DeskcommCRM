import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
const mocks = vi.hoisted(() => ({
  enabled: true,
  db: {} as unknown,
  audit: vi.fn(),
  universal: vi.fn(),
  notice: vi.fn(),
}));
vi.mock("@/lib/organizacao/capacidades", () => ({
  capacidadesDaOrganizacao: async () => (mocks.enabled ? ["propostas"] : []),
}));
vi.mock("@/lib/instalacao/modulos", () => ({ moduloLigado: async () => mocks.enabled }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/mcp/audit", () => ({ auditMcpToolCall: mocks.universal }));
vi.mock("@/lib/mcp/rate-limit", () => ({ verificarTetoMcp: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.db }));
vi.mock("@/lib/propostas/aviso-de-revisao", () => ({
  resolverAvisoDeRevisaoSeProntaOuEncerrada: mocks.notice,
}));
import {
  crmListProposals,
  crmGetProposal,
  crmUpdateDraftProposal,
  crmListHonorariosContratos,
} from "./parity-162";
import { MCP_REGISTRY } from "@/lib/mcp/registry";
import { catalogEntry, deCapacidadeDesligada, deModuloDesligado } from "./catalog";
import { authorizeTool, domainScope, managedAreaOfTool } from "@/lib/mcp/policy";
import { ensureRole } from "@/lib/mcp/auth";
import { createMcpServer } from "@/lib/mcp/server";
import type { McpContext, McpToolDefinition } from "@/lib/mcp/types";
const org = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const id = "20000000-0000-4000-8000-000000000001";
const product = "30000000-0000-4000-8000-000000000001";
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let effects: string[];
let missingTable: boolean;
function database() {
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let operation = "select";
      let payload: Row | Row[] = {};
      let cap = Infinity;
      let sortKey = "";
      let ascending = true;
      const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const result = () => {
        if (missingTable && table === "honorarios_contratos")
          return { data: null, error: { code: "42P01", message: "sigilo" } };
        const found = rows();
        if (operation === "update") {
          effects.push(table);
          for (const r of found) Object.assign(r, payload);
        }
        if (operation === "delete") {
          effects.push(table);
          tables[table] = (tables[table] ?? []).filter((r) => !found.includes(r));
        }
        if (operation === "insert") {
          effects.push(table);
          tables[table] = [
            ...(tables[table] ?? []),
            ...(Array.isArray(payload) ? payload : [payload]),
          ];
        }
        return {
          data: [...found]
            .sort(
              (a, b) => (String(a[sortKey]) < String(b[sortKey]) ? -1 : 1) * (ascending ? 1 : -1),
            )
            .slice(0, cap),
          error: null,
        };
      };
      const q = {
        select: () => q,
        eq: (key: string, value: unknown) => {
          filters.push((r) => r[key] === value);
          return q;
        },
        in: (key: string, values: unknown[]) => {
          filters.push((r) => values.includes(r[key]));
          return q;
        },
        order: (key: string, opts: { ascending: boolean }) => {
          sortKey = key;
          ascending = opts.ascending;
          return q;
        },
        limit: (n: number) => {
          cap = n;
          return q;
        },
        update: (data: Row) => {
          operation = "update";
          payload = data;
          return q;
        },
        delete: () => {
          operation = "delete";
          return q;
        },
        insert: (data: Row[]) => {
          operation = "insert";
          payload = data;
          return q;
        },
        maybeSingle: async () => {
          const r = result();
          return { ...r, data: r.data?.[0] ?? null };
        },
        then: (resolve: (value: ReturnType<typeof result>) => unknown) =>
          Promise.resolve(result()).then(resolve),
      };
      return q;
    },
  };
}
const ctx = (): McpContext => ({
  organizationId: org,
  role: "manager",
  actor: { type: "api_token", id },
  apiTokenId: id,
  requestId: "parity",
  supabase: mocks.db as McpContext["supabase"],
});
const tools = [
  crmListProposals,
  crmGetProposal,
  crmUpdateDraftProposal,
  crmListHonorariosContratos,
] as unknown as ReadonlyArray<McpToolDefinition>;
const item = {
  product_id: product,
  descricao: "texto sigiloso",
  quantidade: 2,
  preco_unitario_cents: 1,
  desconto_cents: 0,
  position: 1000,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = true;
  effects = [];
  missingTable = false;
  tables = {
    crm_proposals: [
      { id, organization_id: org, status: "rascunho", revision: 1, moeda: "BRL", lead_id: id },
      { id: product, organization_id: other, status: "rascunho" },
    ],
    crm_proposal_items: [{ ...item, organization_id: org, proposal_id: id }],
    catalog_products: [
      { id: product, organization_id: org, preco_cents: 100, moeda: "BRL", ativo: true },
    ],
    honorarios_contratos: [
      { id, organization_id: org, lead_id: id },
      { id: product, organization_id: other },
    ],
  };
  mocks.db = database();
});
describe("propostas e listagem de honorários", () => {
  it("registry, catálogo, manager, domínio e área explícitos", () => {
    for (const tool of tools) {
      expect(MCP_REGISTRY.find((t) => t.name === tool.name)).toBe(tool);
      expect(catalogEntry(tool.name)?.apenasHumano).toBe(true);
      expect(domainScope(tool)).toBe(`operations:${tool.category}`);
      expect(managedAreaOfTool(tool)).toBe(
        tool === crmListHonorariosContratos ? "/app/honorarios" : "/app/proposals",
      );
      expect(() => ensureRole("agent", tool.requiresRole)).toThrow();
      expect(() =>
        authorizeTool({ ...ctx(), scopes: [tool.requiresScope, "contacts:read"] }, tool),
      ).toThrow("scope_missing");
      expect(() =>
        authorizeTool(
          {
            ...ctx(),
            scopes: [
              tool.requiresScope,
              "operations:read",
              "operations:write",
              "tool:crm_get_contact",
            ],
          },
          tool,
        ),
      ).toThrow("not_allowed");
    }
  });
  it("filtros opcionais e detalhe/drift não atravessam tenant", async () => {
    expect(await crmListProposals.handler({}, ctx())).toHaveLength(1);
    expect(await crmListProposals.handler({ status: "rascunho", lead_id: id }, ctx())).toHaveLength(
      1,
    );
    expect(await crmListHonorariosContratos.handler({}, ctx())).toHaveLength(1);
    expect(await crmListHonorariosContratos.handler({ lead_id: product }, ctx())).toEqual([]);
    expect(await crmGetProposal.handler({ proposal_id: id }, ctx())).toMatchObject({
      itens: [{ preco_catalogo_atual_cents: 100 }],
    });
    await expect(crmGetProposal.handler({ proposal_id: product }, ctx())).rejects.toMatchObject({
      code: "not_found",
    });
    tables.catalog_products![0]!.organization_id = other;
    expect(await crmGetProposal.handler({ proposal_id: id }, ctx())).toMatchObject({
      itens: [{ preco_catalogo_atual_cents: null }],
    });
  });
  it("reprecifica, preserva moeda, audita token sem textos e resolve aviso", async () => {
    expect(
      await crmUpdateDraftProposal.handler(
        { proposal_id: id, revision: 1, titulo: "sigilo", pagamento: "sigilo", itens: [item] },
        ctx(),
      ),
    ).toMatchObject({ revision: 2, total_cents: 200 });
    expect(tables.crm_proposals![0]).toMatchObject({ moeda: "BRL", pricing_status: "catalog" });
    expect(mocks.notice).toHaveBeenCalledWith(mocks.db, org, id);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: null, actorApiTokenId: id }),
    );
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("sigilo");
  });
  it.each(["enviada", "cancelada"])("não edita %s", async (status) => {
    tables.crm_proposals![0]!.status = status;
    await expect(
      crmUpdateDraftProposal.handler({ proposal_id: id, revision: 1, itens: [] }, ctx()),
    ).rejects.toMatchObject({ code: "proposal_context_stale" });
    expect(tables.crm_proposal_items).toHaveLength(1);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("revision e outro tenant falham sem substituir itens", async () => {
    await expect(
      crmUpdateDraftProposal.handler({ proposal_id: id, revision: 2, itens: [] }, ctx()),
    ).rejects.toMatchObject({ code: "proposal_context_stale" });
    await expect(
      crmUpdateDraftProposal.handler({ proposal_id: product, revision: 1, itens: [] }, ctx()),
    ).rejects.toMatchObject({ code: "proposal_context_stale" });
    expect(tables.crm_proposal_items).toHaveLength(1);
  });
  it("moeda diferente e produto de outro tenant recusam a escrita", async () => {
    tables.catalog_products![0]!.moeda = "USD";
    await expect(
      crmUpdateDraftProposal.handler({ proposal_id: id, revision: 1, itens: [item] }, ctx()),
    ).rejects.toMatchObject({ code: "validation_failed" });
    tables.catalog_products![0]!.organization_id = other;
    await expect(
      crmUpdateDraftProposal.handler({ proposal_id: id, revision: 1, itens: [item] }, ctx()),
    ).rejects.toMatchObject({ code: "validation_failed" });
    expect(effects).toEqual([]);
  });
  it("módulo/capacidade OFF e tabela ausente falham fechados", async () => {
    mocks.enabled = false;
    expect(deCapacidadeDesligada(crmGetProposal.name, [])).toBe(true);
    expect(deModuloDesligado(crmListHonorariosContratos.name, [])).toBe(true);
    await expect(crmGetProposal.handler({ proposal_id: id }, ctx())).rejects.toThrow(
      "proposals_capability_disabled",
    );
    await expect(crmListHonorariosContratos.handler({}, ctx())).rejects.toThrow(
      "honorarios_module_disabled",
    );
    mocks.enabled = true;
    missingTable = true;
    await expect(crmListHonorariosContratos.handler({}, ctx())).rejects.toMatchObject({
      code: "module_not_installed",
    });
  });
  it("valida IDs e enum canônico", () => {
    expect(z.object(crmListProposals.inputSchema).safeParse({ status: "vencida" }).success).toBe(
      true,
    );
    expect(z.object(crmListProposals.inputSchema).safeParse({ status: "expirada" }).success).toBe(
      false,
    );
    expect(
      z.object(crmGetProposal.inputSchema).safeParse({ proposal_id: "inválido" }).success,
    ).toBe(false);
  });
  it("ingresso MCP real redige args e erro", async () => {
    const server = createMcpServer(
      {
        ...ctx(),
        scopes: ["mcp:write", "operations:write", `tool:${crmUpdateDraftProposal.name}`],
      },
      "parity",
      ["propostas"],
      ["propostas"],
    );
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "parity", version: "1" });
    try {
      await server.connect(st);
      await client.connect(ct);
      await client.callTool({
        name: crmUpdateDraftProposal.name,
        arguments: {
          proposal_id: id,
          revision: 1,
          titulo: "sigilo",
          itens: [{ ...item, product_id: null }],
        },
      });
      const call = mocks.universal.mock.lastCall?.[0];
      expect(call.args).toMatchObject({ proposal_id_present: true, revision: 1, item_count: 1 });
      expect(JSON.stringify(call.args)).not.toContain("sigilo");
      tables.catalog_products![0]!.organization_id = other;
      await client.callTool({
        name: crmUpdateDraftProposal.name,
        arguments: { proposal_id: id, revision: 2, itens: [item] },
      });
      expect(JSON.stringify(mocks.universal.mock.lastCall)).not.toContain("texto sigiloso");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
