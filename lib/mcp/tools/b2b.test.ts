import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  enabled: true,
  audit: vi.fn(),
  listCompaniesHandler: vi.fn(), getCompanyHandler: vi.fn(), createCompanyHandler: vi.fn(), patchCompanyHandler: vi.fn(),
  listPeopleHandler: vi.fn(), getPersonHandler: vi.fn(), createPersonHandler: vi.fn(), patchPersonHandler: vi.fn(),
  linkCompanyPersonHandler: vi.fn(), patchCompanyPersonHandler: vi.fn(), linkContactToPersonHandler: vi.fn(),
  listImportBatchesHandler: vi.fn(), getImportBatchHandler: vi.fn(),
}));
vi.mock("@/lib/instalacao/modulos", () => ({ moduloLigado: async () => mocks.enabled }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/crm-b2b/companies-handler", () => ({
  listCompaniesHandler: mocks.listCompaniesHandler, getCompanyHandler: mocks.getCompanyHandler,
  createCompanyHandler: mocks.createCompanyHandler, patchCompanyHandler: mocks.patchCompanyHandler,
}));
vi.mock("@/lib/crm-b2b/people-handler", () => ({
  listPeopleHandler: mocks.listPeopleHandler, getPersonHandler: mocks.getPersonHandler,
  createPersonHandler: mocks.createPersonHandler, patchPersonHandler: mocks.patchPersonHandler,
  linkCompanyPersonHandler: mocks.linkCompanyPersonHandler, patchCompanyPersonHandler: mocks.patchCompanyPersonHandler,
  linkContactToPersonHandler: mocks.linkContactToPersonHandler,
}));
vi.mock("@/lib/crm-b2b/import-handlers", () => ({
  listImportBatchesHandler: mocks.listImportBatchesHandler, getImportBatchHandler: mocks.getImportBatchHandler,
}));

import { B2B_MCP_TOOLS } from "./b2b";
import { auditMcpToolCall } from "../audit";
import type { McpContext } from "../types";

const org = "10000000-0000-4000-8000-000000000001";
const other = "20000000-0000-4000-8000-000000000002";
const human = "30000000-0000-4000-8000-000000000003";
const token = "40000000-0000-4000-8000-000000000004";
const context = {
  organizationId: org, role: "manager", actor: { type: "api_token", id: token, role: "manager" },
  apiTokenId: token, provisionedByUserId: human, requestId: "req-b2b", supabase: {},
} as McpContext;

const cases = [
  ["crm_list_companies", { search: "Empresa Secreta", limit: 50 }, mocks.listCompaniesHandler],
  ["crm_get_company", { company_id: other }, mocks.getCompanyHandler],
  ["crm_create_company", { trade_name: "Empresa Secreta", cnpj: "11222333000181" }, mocks.createCompanyHandler],
  ["crm_update_company", { company_id: other, email: "sigilo@example.test" }, mocks.patchCompanyHandler],
  ["crm_list_people", { search: "Nome Secreto", limit: 50 }, mocks.listPeopleHandler],
  ["crm_get_person", { person_id: other }, mocks.getPersonHandler],
  ["crm_create_person", { full_name: "Nome Secreto" }, mocks.createPersonHandler],
  ["crm_update_person", { person_id: other, notes: "Nota secreta" }, mocks.patchPersonHandler],
  ["crm_link_company_person", { company_id: other, person_id: other, job_title: "Cargo secreto" }, mocks.linkCompanyPersonHandler],
  ["crm_update_company_person", { link_id: other, department: "Depto secreto" }, mocks.patchCompanyPersonHandler],
  ["crm_link_contact_person", { contact_id: other, person_id: other }, mocks.linkContactToPersonHandler],
  ["crm_list_import_batches", {}, mocks.listImportBatchesHandler],
  ["crm_get_import_batch", { batch_id: other, status: "failed" }, mocks.getImportBatchHandler],
] as const;

describe("paridade MCP B2B", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled = true;
    for (const [, , fn] of cases) fn.mockResolvedValue({ id: org });
  });

  it("registry B2B e serviços canônicos têm cobertura 1:1; tenant vem do contexto", async () => {
    expect(B2B_MCP_TOOLS.map((tool) => tool.name)).toEqual(cases.map(([name]) => name));
    for (const [name, input, fn] of cases) {
      const tool = B2B_MCP_TOOLS.find((candidate) => candidate.name === name)!;
      expect(Object.keys(tool.inputSchema)).not.toContain("organization_id");
      await tool.handler(input as never, context);
      expect(fn, name).toHaveBeenCalledTimes(1);
      const args = fn.mock.lastCall ?? [];
      expect(args[0]).toBe(context.supabase);
      expect(args[1]).toMatchObject({ organization_id: org, requestId: "req-b2b" });
      expect(JSON.stringify(args)).not.toContain(`organization_id":"${other}`);
      fn.mockClear();
    }
    expect(mocks.createCompanyHandler.mock.calls).toHaveLength(0);
  });

  it("escritas usam proveniência humana válida, token como ator, e nunca pedem BrasilAPI", async () => {
    await B2B_MCP_TOOLS.find((tool) => tool.name === "crm_create_company")!.handler({ trade_name: "A" }, context);
    expect(mocks.createCompanyHandler).toHaveBeenCalledWith(
      context.supabase, expect.objectContaining({ actor: context.actor }), human,
      expect.objectContaining({ enrich: false }),
    );
    await B2B_MCP_TOOLS.find((tool) => tool.name === "crm_update_company")!.handler({ company_id: other, enrich: true }, context);
    expect(mocks.patchCompanyHandler.mock.lastCall?.[4]).toMatchObject({ enrich: false });
    await expect(B2B_MCP_TOOLS.find((tool) => tool.name === "crm_create_person")!.handler(
      { full_name: "A" }, { ...context, provisionedByUserId: undefined },
    )).rejects.toThrow("human_provenance_required");
  });

  it("módulo desligado bloqueia todas as chamadas diretas antes dos serviços", async () => {
    mocks.enabled = false;
    for (const [name, input, fn] of cases) {
      await expect(B2B_MCP_TOOLS.find((tool) => tool.name === name)!.handler(input as never, context))
        .rejects.toThrow("crm_b2b_module_disabled");
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("schema valida IDs e dados; organização e enrichment não são campos públicos", () => {
    for (const tool of B2B_MCP_TOOLS) {
      expect(Object.keys(tool.inputSchema)).not.toContain("organization_id");
    }
    const create = B2B_MCP_TOOLS.find((tool) => tool.name === "crm_create_company")!;
    expect(Object.keys(create.inputSchema)).not.toContain("enrich");
    const invalid: Record<string, Record<string, unknown>> = {
      crm_list_companies: { search: 123 }, crm_get_company: { company_id: "invalid" },
      crm_create_company: { email: "invalid" }, crm_update_company: { company_id: "invalid" },
      crm_list_people: { search: 123 }, crm_get_person: { person_id: "invalid" },
      crm_create_person: { email: "invalid" }, crm_update_person: { person_id: "invalid" },
      crm_link_company_person: { company_id: other, person_id: "invalid" },
      crm_update_company_person: { link_id: "invalid" },
      crm_link_contact_person: { contact_id: "invalid", person_id: other },
      crm_get_import_batch: { batch_id: "invalid" },
    };
    for (const [name, input] of Object.entries(invalid)) {
      const tool = B2B_MCP_TOOLS.find((candidate) => candidate.name === name)!;
      expect(z.object(tool.inputSchema).safeParse(input).success, name).toBe(false);
    }
  });

  it("audit metadata não contém PII de nenhuma entrada B2B", async () => {
    for (const [name, input] of cases) {
      const tool = B2B_MCP_TOOLS.find((candidate) => candidate.name === name)!;
      const redacted = tool.redigirParaAuditoria?.({ ...input, legal_name: "Razão Secreta", phone: "+5585999999999", street: "Rua Privada", notes: "Nota Privada" });
      await auditMcpToolCall({ ctx: context, toolName: name, args: redacted ?? {}, durationMs: 1, success: true });
      const metadata = JSON.stringify(mocks.audit.mock.lastCall?.[0]?.metadata);
      for (const secret of ["Empresa Secreta", "Nome Secreto", "11222333000181", "sigilo@example.test", "Nota secreta", "Cargo secreto", "Depto secreto", "Razão Secreta", "+5585999999999", "Rua Privada", "Nota Privada"]) {
        expect(metadata, name).not.toContain(secret);
      }
    }
  });
});
