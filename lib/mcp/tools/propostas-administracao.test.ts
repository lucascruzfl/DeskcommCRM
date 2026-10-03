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
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/mcp/audit", () => ({ auditMcpToolCall: mocks.universal }));
vi.mock("@/lib/mcp/rate-limit", () => ({ verificarTetoMcp: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.db }));
vi.mock("@/lib/propostas/aviso-de-revisao", () => ({
  resolverAvisoDeRevisaoSeProntaOuEncerrada: mocks.notice,
}));
import * as tools from "./propostas-administracao";
import { MCP_REGISTRY } from "@/lib/mcp/registry";
import { catalogEntry, deCapacidadeDesligada } from "./catalog";
import { authorizeTool, domainScope, managedAreaOfTool } from "@/lib/mcp/policy";
import { buildManagedAreaPolicy } from "@/lib/managed-clients/policy";
import { MANAGED_CLIENT_PRESETS } from "@/lib/managed-clients/presets";
import { ensureRole } from "@/lib/mcp/auth";
import { createMcpServer } from "@/lib/mcp/server";
import type { McpContext, McpToolDefinition } from "@/lib/mcp/types";
const org = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const id = "20000000-0000-4000-8000-000000000001";
const foreign = "20000000-0000-4000-8000-000000000002";
const product = "30000000-0000-4000-8000-000000000001";
const secret = "CONTEUDO_COMERCIAL_SIGILOSO";
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let effects: string[];
let race: boolean;
let insertError: boolean;
let failItems: boolean;
let seq: number;
let failSettingsRead: boolean;
function database() {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let action = "select";
      let payload: Row | Row[] = {};
      let sortKey = "";
      let asc = true;
      let cap = Infinity;
      const execute = () => {
        if (failSettingsRead && table === "organizations" && action === "select")
          return { data: null, error: { message: secret } };
        if (race && action === "update" && table === "crm_proposals") {
          tables.crm_proposals![0]!.status = "enviada";
          race = false;
        }
        let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        if (action === "insert") {
          if (
            insertError ||
            (table === "crm_proposals" &&
              rows.some((r) => r.organization_id === org && r.status === "rascunho"))
          )
            return { data: null, error: { code: "23505", message: secret } };
          if (table === "crm_proposal_items" && failItems)
            return { data: null, error: { message: secret } };
          rows = (Array.isArray(payload) ? payload : [payload]).map((r) => ({
            id: `40000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
            ...r,
          }));
          (tables[table] ??= []).push(...rows);
          effects.push(table);
        }
        if (action === "update") {
          rows.forEach((r) => Object.assign(r, payload));
          if (rows.length) effects.push(table);
        }
        if (action === "delete") {
          tables[table] = (tables[table] ?? []).filter((r) => !rows.includes(r));
          if (rows.length) effects.push(table);
        }
        return {
          data: rows
            .slice()
            .sort((a, b) => (String(a[sortKey]) < String(b[sortKey]) ? -1 : 1) * (asc ? 1 : -1))
            .slice(0, cap),
          error: null,
        };
      };
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => {
          filters.push((r) => r[k] === v);
          return q;
        },
        order: (k: string, opts?: { ascending?: boolean }) => {
          sortKey = k;
          asc = opts?.ascending ?? true;
          return q;
        },
        limit: (n: number) => {
          cap = n;
          return q;
        },
        update: (p: Row) => {
          action = "update";
          payload = p;
          return q;
        },
        insert: (p: Row | Row[]) => {
          action = "insert";
          payload = p;
          return q;
        },
        delete: () => {
          action = "delete";
          return q;
        },
        maybeSingle: async () => {
          const r = execute();
          return { ...r, data: r.data?.[0] ?? null };
        },
        single: async () => {
          const r = execute();
          return { ...r, data: r.data?.[0] ?? null };
        },
        then: (resolve: (r: ReturnType<typeof execute>) => unknown) =>
          Promise.resolve(execute()).then(resolve),
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
  requestId: "phase2",
  supabase: mocks.db as McpContext["supabase"],
});
const sections = [
  {
    id: "resumo",
    title: "Resumo",
    body: "Projeto {{project.name}}",
    required: true,
    conditional: false,
  },
];
const draft = () => tables.crm_proposals![0]!;
const inputs: Record<string, Record<string, unknown>> = {
  crm_get_proposal_document: { proposal_id: id },
  crm_update_proposal_document_field: { proposal_id: id, campo: "project.name", valor: secret },
  crm_update_proposal_document_section: { proposal_id: id, secaoId: "resumo", texto: secret },
  crm_create_proposal_revision: { proposal_id: id, motivo: secret },
  crm_discard_draft_proposal: { proposal_id: id },
  crm_list_proposal_templates: {},
  crm_get_proposal_template: { template_slug: "empresa_local" },
  crm_create_proposal_template: { nome: secret },
  crm_customize_proposal_template: { template_slug: "site_institucional" },
  crm_set_proposal_template_visibility: { template_slug: "site_institucional", visible: false },
  crm_update_proposal_template: {
    template_slug: "empresa_local",
    nome: secret,
    descricao: secret,
    sections,
    section_order: ["resumo"],
  },
  crm_deactivate_proposal_template: { template_slug: "empresa_local" },
  crm_get_proposal_settings: {},
  crm_update_proposal_defaults: { default_valid_days: 20, default_conditions: secret },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = true;
  effects = [];
  race = false;
  insertError = false;
  failItems = false;
  seq = 0;
  failSettingsRead = false;
  tables = {
    crm_proposals: [
      {
        id,
        organization_id: org,
        status: "rascunho",
        revision: 4,
        moeda: "BRL",
        numero: 1,
        ano: 2026,
        versao: 1,
        lead_id: id,
        template_slug: "empresa_local",
        pricing_status: "catalog",
        briefing_json: { client: { company: "Empresa" } },
        secoes_editadas: null,
        contact_id: null,
        total_cents: 100,
        created_at: "2026-10-01",
        prazo_dias_uteis: 10,
        valid_until: "2026-12-01",
        pagamento: "interno",
      },
      {
        id: foreign,
        organization_id: other,
        status: "rascunho",
        template_slug: "empresa_estrangeira",
        briefing_json: { project: { name: secret } },
      },
    ],
    crm_proposal_items: [
      {
        organization_id: org,
        proposal_id: id,
        product_id: product,
        descricao: secret,
        quantidade: 2,
        preco_unitario_cents: 1,
        desconto_cents: 0,
        position: 1000,
      },
    ],
    catalog_products: [
      { id: product, organization_id: org, preco_cents: 150, moeda: "BRL", ativo: true },
    ],
    proposal_templates: [
      {
        id,
        organization_id: org,
        slug: "empresa_local",
        nome: "Modelo local",
        is_active: true,
        version: 2,
        sections,
        section_order: ["resumo"],
      },
      {
        id: foreign,
        organization_id: other,
        slug: "empresa_estrangeira",
        nome: secret,
        is_active: true,
        version: 9,
        sections: [{ ...sections[0], body: secret }],
        section_order: ["resumo"],
      },
    ],
    organizations: [
      {
        id: org,
        settings: {
          unrelated: 1,
          proposals: {
            enabled: true,
            avisar_no_whatsapp: false,
            followup_dias: 7,
            modelos_ocultos: [],
          },
        },
      },
      { id: other, settings: { proposals: { default_conditions: secret } } },
    ],
  };
  mocks.db = database();
});
describe("fase 2: contrato de todas as tools", () => {
  it.each(tools.PROPOSTAS_ADMINISTRACAO_MCP_TOOLS)(
    "$name: registry, catalog, role, scopes, área e capability",
    async (tool) => {
      expect(MCP_REGISTRY.find((t) => t.name === tool.name)).toBe(tool);
      expect(catalogEntry(tool.name)).toMatchObject({
        capacidade: "propostas",
        apenasHumano: true,
      });
      const area =
        tool.domain === "templates"
          ? "/app/settings/tenant/proposals/modelos"
          : tool.domain === "settings"
            ? "/app/settings/tenant/proposals"
            : "/app/proposals";
      expect(managedAreaOfTool(tool)).toBe(area);
      const preset = Object.values(MANAGED_CLIENT_PRESETS)[0]!;
      const managedPolicy = buildManagedAreaPolicy(preset.id, [
        { href: area, classification: "agency" },
      ]);
      expect(() =>
        authorizeTool(
          {
            ...ctx(),
            managedPolicy,
            scopes: [tool.requiresScope, domainScope(tool), "capability:destructive_operations"],
          },
          tool,
        ),
      ).toThrow("managed_area_denied");
      expect(domainScope(tool)).toBe(`${tool.domain}:${tool.category}`);
      expect(() => ensureRole("agent", tool.requiresRole)).toThrow();
      expect(() => authorizeTool({ ...ctx(), scopes: [] }, tool)).toThrow("scope_missing");
      expect(() =>
        authorizeTool({ ...ctx(), scopes: [tool.requiresScope, "contacts:read"] }, tool),
      ).toThrow("scope_missing");
      expect(() =>
        authorizeTool(
          { ...ctx(), scopes: [tool.requiresScope, domainScope(tool), "tool:crm_get_contact"] },
          tool,
        ),
      ).toThrow("not_allowed");
      expect(deCapacidadeDesligada(tool.name, [])).toBe(true);
      mocks.enabled = false;
      await expect(tool.handler(inputs[tool.name]!, ctx())).rejects.toThrow(
        "proposals_capability_disabled",
      );
      expect(effects).toEqual([]);
    },
  );
  it.each(tools.PROPOSTAS_ADMINISTRACAO_MCP_TOOLS)(
    "$name: execução canônica e auditoria segura no ingresso real",
    async (tool) => {
      if (tool.name === tools.crmCreateProposalRevision.name) draft().status = "enviada";
      const server = createMcpServer(
        {
          ...ctx(),
          scopes: [
            tool.requiresScope,
            domainScope(tool),
            `tool:${tool.name}`,
            "capability:destructive_operations",
          ],
        },
        "phase2",
        ["propostas"],
        ["propostas"],
      );
      const [ct, st] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "phase2", version: "1" });
      try {
        await server.connect(st);
        await client.connect(ct);
        const result = await client.callTool({ name: tool.name, arguments: inputs[tool.name] });
        expect(result.isError).not.toBe(true);
        expect(mocks.universal).toHaveBeenCalled();
        expect(JSON.stringify(mocks.universal.mock.calls)).not.toContain(secret);
        expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(secret);
        if (tool.category === "write")
          expect(mocks.audit).toHaveBeenCalledWith(
            expect.objectContaining({
              actorUserId: null,
              actorApiTokenId: id,
              organizationId: org,
            }),
          );
        expect(tool.redigirErroParaAuditoria?.(secret)).not.toContain(secret);
        mocks.enabled = false;
        const denied = await client.callTool({ name: tool.name, arguments: inputs[tool.name] });
        expect(denied.isError).toBe(true);
        expect(JSON.stringify(mocks.universal.mock.calls)).not.toContain(secret);
      } finally {
        await client.close();
        await server.close();
      }
    },
  );
  it("descarte e desativação exigem destructive_operations", () => {
    for (const tool of [
      tools.crmDiscardDraftProposal,
      tools.crmDeactivateProposalTemplate,
    ] as unknown as McpToolDefinition[])
      expect(() =>
        authorizeTool({ ...ctx(), scopes: [tool.requiresScope, domainScope(tool)] }, tool),
      ).toThrow("capability");
  });
  it("dados sensíveis não entram em metadata, nem chaves livres", () => {
    for (const tool of tools.PROPOSTAS_ADMINISTRACAO_MCP_TOOLS) {
      const args = {
        titulo: secret,
        campo: secret,
        template_slug: secret,
        secoes_editadas: secret,
        sections: [{ body: secret }],
        [secret]: secret,
      };
      expect(JSON.stringify(tool.redigirParaAuditoria?.(args))).not.toContain(secret);
    }
  });
});
describe("documento, cadeia de revisão e descarte", () => {
  it("documento é estruturado, com preço canônico e sem efeito/arquivo", async () => {
    const doc = await tools.crmGetProposalDocument.handler({ proposal_id: id }, ctx());
    expect(doc).toMatchObject({
      modeloSlug: "empresa_local",
      secoes: [{ body: "Projeto [a definir]" }],
      camposFaltando: [{ caminho: "project.name" }],
    });
    expect(effects).toEqual([]);
    expect(mocks.audit).not.toHaveBeenCalled();
    await expect(
      tools.crmGetProposalDocument.handler({ proposal_id: foreign }, ctx()),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it("campo e seção explícitos preservam contexto; null restaura modelo", async () => {
    await tools.crmUpdateProposalDocumentField.handler(
      inputs.crm_update_proposal_document_field as never,
      ctx(),
    );
    expect(draft().briefing_json).toEqual({
      client: { company: "Empresa" },
      project: { name: secret },
    });
    await tools.crmUpdateProposalDocumentSection.handler(
      inputs.crm_update_proposal_document_section as never,
      ctx(),
    );
    expect(draft().secoes_editadas).toEqual({ resumo: secret });
    await tools.crmUpdateProposalDocumentSection.handler(
      { proposal_id: id, secaoId: "resumo", texto: null },
      ctx(),
    );
    expect(draft().secoes_editadas).toBeNull();
    expect(mocks.notice).toHaveBeenCalledWith(mocks.db, org, id);
  });
  it.each(["enviada", "cancelada"])(
    "%s não recebe edição documental nem descarte",
    async (status) => {
      draft().status = status;
      for (const tool of [
        tools.crmUpdateProposalDocumentField,
        tools.crmUpdateProposalDocumentSection,
        tools.crmDiscardDraftProposal,
      ] as unknown as McpToolDefinition[])
        await expect(tool.handler(inputs[tool.name]!, ctx())).rejects.toMatchObject({
          code: "proposal_context_stale",
        });
      expect(effects).toEqual([]);
    },
  );
  it("corrida de envio entre leitura e escrita recusa sem mudar documento", async () => {
    race = true;
    await expect(
      tools.crmUpdateProposalDocumentSection.handler(
        inputs.crm_update_proposal_document_section as never,
        ctx(),
      ),
    ).rejects.toMatchObject({ code: "proposal_context_stale" });
    expect(draft().secoes_editadas).toBeNull();
    expect(effects).toEqual([]);
  });
  it("ID estrangeiro e campo fora do modelo não sofrem escrita", async () => {
    for (const tool of [
      tools.crmUpdateProposalDocumentField,
      tools.crmUpdateProposalDocumentSection,
      tools.crmDiscardDraftProposal,
      tools.crmCreateProposalRevision,
    ] as unknown as McpToolDefinition[])
      await expect(
        tool.handler({ ...inputs[tool.name], proposal_id: foreign }, ctx()),
      ).rejects.toMatchObject({
        code:
          tool.name === tools.crmDiscardDraftProposal.name ? "proposal_context_stale" : "not_found",
      });
    await expect(
      tools.crmUpdateProposalDocumentField.handler(
        { proposal_id: id, campo: "investment.total_formatted", valor: secret },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
    expect(effects).toEqual([]);
  });
  it("valida ID, texto vazio e prototype pollution na borda", async () => {
    await expect(
      tools.crmGetProposalDocument.handler({ proposal_id: "ruim" }, ctx()),
    ).rejects.toBeInstanceOf(z.ZodError);
    await expect(
      tools.crmUpdateProposalDocumentField.handler(
        { proposal_id: id, campo: "__proto__.name", valor: secret },
        ctx(),
      ),
    ).rejects.toBeInstanceOf(z.ZodError);
    await expect(
      tools.crmUpdateProposalDocumentSection.handler(
        { proposal_id: id, secaoId: "resumo", texto: " " },
        ctx(),
      ),
    ).rejects.toBeInstanceOf(z.ZodError);
  });
  it("revisão mantém enviada anterior, herda moeda/cadeia e reprecifica catálogo", async () => {
    draft().status = "enviada";
    const prior = structuredClone(draft());
    const result = (await tools.crmCreateProposalRevision.handler(
      { proposal_id: id, motivo: secret },
      ctx(),
    )) as { id: string };
    expect(draft()).toEqual(prior);
    expect(tables.crm_proposals?.find((r) => r.id === result.id)).toMatchObject({
      organization_id: org,
      status: "rascunho",
      versao: 2,
      substitui_id: id,
      moeda: "BRL",
      total_cents: 300,
      numero: 1,
      ano: 2026,
    });
    expect(tables.crm_proposal_items?.find((r) => r.proposal_id === result.id)).toMatchObject({
      organization_id: org,
      preco_unitario_cents: 150,
    });
    await expect(
      tools.crmCreateProposalRevision.handler({ proposal_id: id }, ctx()),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      tables.crm_proposals?.filter((r) => r.organization_id === org && r.status === "rascunho"),
    ).toHaveLength(1);
    await tools.crmDiscardDraftProposal.handler({ proposal_id: result.id }, ctx());
    expect(draft()).toEqual(prior);
    expect(mocks.notice).toHaveBeenCalledWith(mocks.db, org, result.id, { forcar: true });
  });
  it.each(["rascunho", "cancelada", "aceita", "substituida"])(
    "não cria revisão de %s",
    async (status) => {
      draft().status = status;
      await expect(
        tools.crmCreateProposalRevision.handler({ proposal_id: id }, ctx()),
      ).rejects.toMatchObject({ code: "proposal_context_stale" });
      expect(effects).toEqual([]);
    },
  );
  it("produto estrangeiro e moeda divergente recusam revisão", async () => {
    draft().status = "enviada";
    tables.catalog_products![0]!.organization_id = other;
    await expect(
      tools.crmCreateProposalRevision.handler({ proposal_id: id }, ctx()),
    ).rejects.toMatchObject({ code: "validation_failed" });
    tables.catalog_products![0]!.organization_id = org;
    tables.catalog_products![0]!.moeda = "USD";
    await expect(
      tools.crmCreateProposalRevision.handler({ proposal_id: id }, ctx()),
    ).rejects.toMatchObject({ code: "validation_failed" });
    expect(effects).toEqual([]);
  });
  it("falha de itens limpa somente novo rascunho, não enviada anterior", async () => {
    draft().status = "enviada";
    failItems = true;
    await expect(
      tools.crmCreateProposalRevision.handler({ proposal_id: id }, ctx()),
    ).rejects.toMatchObject({ code: "internal_error" });
    expect(tables.crm_proposals).toHaveLength(2);
    expect(draft().status).toBe("enviada");
    expect(tables.crm_proposals![1]!.id).toBe(foreign);
  });
});
describe("modelos e defaults seguros", () => {
  it("cópia estrangeira não aparece em lista, leitura, edição ou desativação", async () => {
    expect(JSON.stringify(await tools.crmListProposalTemplates.handler({}, ctx()))).not.toContain(
      secret,
    );
    await expect(
      tools.crmGetProposalTemplate.handler({ template_slug: "empresa_estrangeira" }, ctx()),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      tools.crmUpdateProposalTemplate.handler(
        { ...inputs.crm_update_proposal_template, template_slug: "empresa_estrangeira" } as never,
        ctx(),
      ),
    ).rejects.toMatchObject({ code: "state_conflict" });
    await expect(
      tools.crmDeactivateProposalTemplate.handler({ template_slug: "empresa_estrangeira" }, ctx()),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(effects).toEqual([]);
  });
  it("personalizar é org-scoped; edição versiona; desativar preserva e retorna base pública", async () => {
    await tools.crmCustomizeProposalTemplate.handler(
      { template_slug: "site_institucional" },
      ctx(),
    );
    await expect(
      tools.crmCustomizeProposalTemplate.handler({ template_slug: "site_institucional" }, ctx()),
    ).rejects.toMatchObject({ code: "state_conflict" });
    await tools.crmUpdateProposalTemplate.handler(
      { ...inputs.crm_update_proposal_template, template_slug: "site_institucional" } as never,
      ctx(),
    );
    await tools.crmDeactivateProposalTemplate.handler(
      { template_slug: "site_institucional" },
      ctx(),
    );
    expect(tables.proposal_templates?.find((r) => r.slug === "site_institucional")).toMatchObject({
      organization_id: org,
      is_active: false,
      version: 2,
    });
    expect(
      await tools.crmGetProposalTemplate.handler({ template_slug: "site_institucional" }, ctx()),
    ).toMatchObject({ origem: "plataforma", version: 1 });
  });
  it("modelo inválido e conflito de insert não produzem cópia", async () => {
    await expect(
      tools.crmCreateProposalTemplate.handler({ nome: "x" }, ctx()),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expect(
      tools.crmUpdateProposalTemplate.handler(
        { ...inputs.crm_update_proposal_template, section_order: ["fantasma"] } as never,
        ctx(),
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
    insertError = true;
    await expect(
      tools.crmCreateProposalTemplate.handler({ nome: secret }, ctx()),
    ).rejects.toMatchObject({ code: "state_conflict" });
    expect(effects).toEqual([]);
  });
  it("visibilidade e defaults fazem merge sem alterar automação/WhatsApp/outra organização", async () => {
    const foreignSettings = structuredClone(tables.organizations![1]);
    await tools.crmSetProposalTemplateVisibility.handler(
      { template_slug: "site_institucional", visible: false },
      ctx(),
    );
    await tools.crmUpdateProposalDefaults.handler(
      { default_valid_days: 20, default_conditions: secret },
      ctx(),
    );
    expect(tables.organizations![0]!.settings).toMatchObject({
      unrelated: 1,
      proposals: {
        enabled: true,
        avisar_no_whatsapp: false,
        followup_dias: 7,
        modelos_ocultos: ["site_institucional"],
        default_valid_days: 20,
      },
    });
    expect(tables.organizations![1]).toEqual(foreignSettings);
    expect(await tools.crmGetProposalSettings.handler({}, ctx())).toMatchObject({
      default_valid_days: 20,
      followup_dias: 7,
    });
    await expect(
      tools.crmUpdateProposalDefaults.handler(
        { default_valid_days: 20, default_conditions: null, enabled: false } as never,
        ctx(),
      ),
    ).rejects.toBeInstanceOf(z.ZodError);
    await expect(
      tools.crmSetProposalTemplateVisibility.handler(
        { template_slug: "empresa_estrangeira", visible: false },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
  it("não sobrescreve settings quando a leitura necessária ao merge falha", async () => {
    const previous = structuredClone(tables.organizations);
    failSettingsRead = true;
    await expect(
      tools.crmUpdateProposalDefaults.handler(
        { default_valid_days: 20, default_conditions: null },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: "internal_error" });
    await expect(
      tools.crmSetProposalTemplateVisibility.handler(
        { template_slug: "site_institucional", visible: false },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: "internal_error" });
    expect(tables.organizations).toEqual(previous);
    expect(effects).toEqual([]);
  });
});
