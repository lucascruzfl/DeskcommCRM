import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const mocks = vi.hoisted(() => ({
  enabled: true,
  audit: vi.fn(),
  universal: vi.fn(),
  db: {} as unknown,
}));
vi.mock("@/lib/instalacao/modulos", () => ({ moduloLigado: async () => mocks.enabled }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/mcp/audit", () => ({ auditMcpToolCall: mocks.universal }));
vi.mock("@/lib/mcp/rate-limit", () => ({ verificarTetoMcp: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.db }));

import {
  PARITY_162_MCP_TOOLS as ALL_PARITY_TOOLS,
  crmGetTagsReport,
  crmCreateHonorariosContrato,
  crmCreateHonorariosParcela,
} from "./parity-162";
import { MCP_REGISTRY } from "@/lib/mcp/registry";
import { MCP_OPERATION_PRESET } from "@/lib/mcp/scopes";
import { authorizeTool, domainScope, managedAreaOfTool } from "@/lib/mcp/policy";
import { catalogEntry, deModuloDesligado } from "@/lib/mcp/tools/catalog";
import { ensureRole, type McpAuthResult } from "@/lib/mcp/auth";
import { createMcpServer } from "@/lib/mcp/server";
import type { McpContext } from "@/lib/mcp/types";
import { buildManagedAreaPolicy } from "@/lib/managed-clients/policy";
import { MANAGED_CLIENT_PRESETS } from "@/lib/managed-clients/presets";

const PARITY_162_MCP_TOOLS = ALL_PARITY_TOOLS.filter((tool) =>
  [
    "crm_get_tags_report",
    "crm_create_honorarios_contrato",
    "crm_create_honorarios_parcela",
  ].includes(tool.name),
);

const org = "10000000-0000-4000-8000-000000000001";
const otherOrg = "10000000-0000-4000-8000-000000000002";
const lead = "20000000-0000-4000-8000-000000000001";
const contrato = "30000000-0000-4000-8000-000000000001";
const token = "40000000-0000-4000-8000-000000000001";
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let inserts: Array<{ table: string; row: Row }>;
let insertError: { code: string; message: string } | null;

// Aplica o predicado de tenant aos dados, inclusive no client que bypassa RLS.
function database() {
  return {
    rpc: async (_name: string, args: { p_org: string }) => ({
      data: (tables.conversations ?? [])
        .filter((row) => row.organization_id === args.p_org)
        .flatMap((row) => (row.tags as string[]).map((tag) => ({ tag }))),
      error: null,
    }),
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let inserted: Row | undefined;
      const rows = () =>
        (tables[table] ?? []).filter((row) => filters.every(([key, value]) => row[key] === value));
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          filters.push([key, value]);
          return query;
        },
        or: () => query,
        order: () => query,
        range: async () => ({ data: rows(), count: rows().length, error: null }),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        insert: (row: Row) => {
          inserted = row;
          inserts.push({ table, row });
          return query;
        },
        single: async () => ({
          data: insertError ? null : { id: contrato, ...inserted, status: "pendente" },
          error: insertError,
        }),
      };
      return query;
    },
  };
}
const context = (): McpContext => ({
  organizationId: org,
  role: "manager",
  actor: { type: "api_token", id: token },
  apiTokenId: token,
  requestId: "parity-test",
  supabase: mocks.db as McpContext["supabase"],
});
const auth = (scopes: readonly string[] = MCP_OPERATION_PRESET): McpAuthResult => ({
  ...context(),
  scopes: [...scopes],
});

async function withClient(
  policy: McpAuthResult,
  modules: readonly "honorarios"[],
  check: (client: Client) => Promise<void>,
) {
  const server = createMcpServer(policy, "parity-test", modules);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "parity-test", version: "0.0.0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await check(client);
  } finally {
    await client.close();
    await server.close();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = true;
  insertError = null;
  inserts = [];
  tables = {
    crm_leads: [{ id: lead, organization_id: org }],
    honorarios_contratos: [{ id: contrato, organization_id: org }],
    conversations: [],
  };
  mocks.db = database();
});

describe("paridade reports/tags e criação interna de honorários", () => {
  it("registry/catalog, domínio, papel e managed area são explícitos", () => {
    for (const tool of PARITY_162_MCP_TOOLS) {
      expect(MCP_REGISTRY.find((item) => item.name === tool.name)).toBe(tool);
      expect(catalogEntry(tool.name)?.category).toBe(tool.category);
      expect(tool.requiresRole).toBe("manager");
      expect(() => ensureRole("agent", tool.requiresRole)).toThrow();
      expect(Object.keys(tool.inputSchema)).not.toContain("organization_id");
      expect(managedAreaOfTool(tool)).toBe(
        tool.name === crmGetTagsReport.name ? "/app/inbox" : "/app/honorarios",
      );
      expect(domainScope(tool)).toBe(
        tool.name === crmGetTagsReport.name ? "conversations:read" : "operations:write",
      );
    }
  });

  it("scope global, domínio granular e allowlist parcial falham fechados", () => {
    for (const tool of PARITY_162_MCP_TOOLS) {
      expect(() => authorizeTool(auth([]), tool)).toThrow("scope_missing");
      expect(() => authorizeTool(auth([tool.requiresScope, "contacts:write"]), tool)).toThrow(
        "scope_missing",
      );
      expect(() => authorizeTool(auth([tool.requiresScope, "tool:crm_get_contact"]), tool)).toThrow(
        "not_allowed",
      );
    }
    const parityNames = [
      ...ALL_PARITY_TOOLS.map((tool) => tool.name),
      ...MCP_REGISTRY.filter((tool) => catalogEntry(tool.name)?.modulo === "crm_b2b").map(
        (tool) => tool.name,
      ),
    ];
    const originalFull = MCP_OPERATION_PRESET.filter(
      (scope) => !parityNames.some((name) => scope === `tool:${name}`),
    );
    for (const tool of PARITY_162_MCP_TOOLS)
      expect(() => authorizeTool(auth(originalFull), tool)).not.toThrow();
  });

  it("managed tenant não recebe honorários fora da área permitida", () => {
    const preset = Object.values(MANAGED_CLIENT_PRESETS)[0]!;
    const policy = buildManagedAreaPolicy(preset.id);
    for (const tool of PARITY_162_MCP_TOOLS.filter((item) => item.category === "write")) {
      expect(() => authorizeTool({ ...auth(), managedPolicy: policy }, tool)).toThrow(
        "managed_area_denied",
      );
    }
  });

  it("manager recebe tools e agente não executa agregado ou escrita", async () => {
    await withClient(auth(), ["honorarios"], async (client) => {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      for (const tool of PARITY_162_MCP_TOOLS) expect(names).toContain(tool.name);
    });
    await withClient({ ...auth(), role: "agent" }, ["honorarios"], async (client) => {
      const result = await client.callTool({
        name: crmCreateHonorariosContrato.name,
        arguments: { modelo: "fixo", valor_fixo_cents: 1 },
      });
      expect(result.isError).toBe(true);
      expect(inserts).toEqual([]);
    });
  });

  it("módulo honorários OFF omite catálogo oferecido e bloqueia handlers diretos", async () => {
    mocks.enabled = false;
    for (const tool of [crmCreateHonorariosContrato, crmCreateHonorariosParcela]) {
      expect(deModuloDesligado(tool.name, [])).toBe(true);
      expect(deModuloDesligado(tool.name, ["honorarios"])).toBe(false);
      await expect(tool.handler({} as never, context())).rejects.toThrow(
        "honorarios_module_disabled",
      );
    }
    await withClient(auth(), [], async (client) => {
      expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain(
        crmCreateHonorariosContrato.name,
      );
    });
    expect(inserts).toEqual([]);
  });

  it("relatório agrega apenas o tenant e não equivale a lista de tags", async () => {
    const row = {
      status: "resolved",
      created_at: "2026-09-01T10:00:00Z",
      awaiting_since: "2026-09-01T10:00:00Z",
      last_outbound_at: "2026-09-01T10:01:00Z",
    };
    tables.conversations = [
      { ...row, id: lead, organization_id: org, tags: ["Assunto privado"] },
      { ...row, id: contrato, organization_id: otherOrg, tags: ["Outro tenant"] },
    ];
    const result = await crmGetTagsReport.handler(
      { de: "2026-09-01", ate: "2026-09-01", tz: "UTC" },
      context(),
    );
    expect(result).toMatchObject({
      total_etiquetagens: 1,
      truncado: false,
      linhas: [{ etiqueta: "Assunto privado", conversas: 1, espera_media_segundos: 60 }],
    });
    expect(JSON.stringify(result)).not.toContain("Outro tenant");
  });

  it.each([
    { de: "2026-99-99" },
    { tz: "Não existe" },
    { de: "2026-09-02", ate: "2026-09-01" },
    { de: "2026-01-01", ate: "2026-12-31" },
    { tags: Array.from({ length: 101 }, (_, index) => `tag${index}`).join(",") },
  ])("relatório recusa parâmetros inválidos %j", async (input) => {
    await expect(crmGetTagsReport.handler(input as never, context())).rejects.toThrow();
  });

  it("contrato e parcela inserem só registros internos com org do contexto", async () => {
    await crmCreateHonorariosContrato.handler(
      { lead_id: lead, modelo: "fixo", valor_fixo_cents: 12345 },
      context(),
    );
    await crmCreateHonorariosParcela.handler(
      { contrato_id: contrato, numero: 1, vencimento: "2026-10-01", valor_cents: 12345 },
      context(),
    );
    expect(inserts.map((entry) => entry.table)).toEqual([
      "honorarios_contratos",
      "honorarios_parcelas",
    ]);
    expect(inserts.every((entry) => entry.row.organization_id === org)).toBe(true);
    expect(inserts[1]!.row).not.toHaveProperty("financial_entry_id");
    expect(inserts[1]!.row).not.toHaveProperty("status");
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: org, actorUserId: null, actorApiTokenId: token }),
    );
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("12345");
  });

  it("IDs cruzados ou inexistentes falham antes de inserir", async () => {
    tables.crm_leads![0]!.organization_id = otherOrg;
    tables.honorarios_contratos![0]!.organization_id = otherOrg;
    await expect(
      crmCreateHonorariosContrato.handler(
        { lead_id: lead, modelo: "fixo", valor_fixo_cents: 1 },
        context(),
      ),
    ).rejects.toThrow("Lead inválido");
    await expect(
      crmCreateHonorariosParcela.handler(
        { contrato_id: contrato, numero: 1, vencimento: "2026-10-01", valor_cents: 1 },
        context(),
      ),
    ).rejects.toThrow("Contrato inválido");
    expect(inserts).toEqual([]);
  });

  it("modelo incompleto, ID inválido e data impossível são recusados", async () => {
    await expect(
      crmCreateHonorariosContrato.handler({ modelo: "misto" }, context()),
    ).rejects.toThrow();
    await expect(
      crmCreateHonorariosParcela.handler(
        { contrato_id: "invalido", numero: 1, vencimento: "2026-10-01", valor_cents: 1 },
        context(),
      ),
    ).rejects.toThrow();
    expect(
      z
        .object(crmCreateHonorariosParcela.inputSchema)
        .safeParse({ contrato_id: contrato, numero: 1, vencimento: "2026-02-30", valor_cents: 1 })
        .success,
    ).toBe(false);
    expect(inserts).toEqual([]);
  });

  it("parcela duplicada preserva o conflito canônico", async () => {
    insertError = { code: "23505", message: "valor privado" };
    await expect(
      crmCreateHonorariosParcela.handler(
        { contrato_id: contrato, numero: 1, vencimento: "2026-10-01", valor_cents: 1 },
        context(),
      ),
    ).rejects.toThrow("Já existe uma parcela");
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("auditoria universal omite filtro sensível, datas, IDs e valores", async () => {
    await withClient(auth(), [], async (client) => {
      await client.callTool({
        name: crmGetTagsReport.name,
        arguments: { de: "2026-09-01", ate: "2026-09-01", tags: "diagnóstico privado" },
      });
    });
    const call = mocks.universal.mock.lastCall?.[0];
    expect(call.resourceType).toBe("conversation_tags_report");
    expect(call.args).toMatchObject({ tags_filter_present: true });
    expect(JSON.stringify(call.args)).not.toContain("diagnóstico privado");
    for (const tool of PARITY_162_MCP_TOOLS) {
      expect(
        JSON.stringify(
          tool.redigirParaAuditoria?.({ tags: "sigilo", lead_id: lead, valor_cents: 12345 }),
        ),
      ).not.toContain("sigilo");
      expect(tool.redigirErroParaAuditoria?.("erro com valor sigiloso")).not.toContain("sigiloso");
    }
  });
});
