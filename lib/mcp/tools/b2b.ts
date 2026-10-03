/** Paridade da família B2B opcional. Cada efeito usa o mesmo handler da rota humana. */
import { z } from "zod";

import type { HandlerCtx } from "@/lib/api/handlers/types";
import { createCompanyHandler, getCompanyHandler, listCompaniesHandler, patchCompanyHandler } from "@/lib/crm-b2b/companies-handler";
import { getImportBatchHandler, listImportBatchesHandler } from "@/lib/crm-b2b/import-handlers";
import { createPersonHandler, getPersonHandler, linkCompanyPersonHandler, linkContactToPersonHandler, listPeopleHandler, patchCompanyPersonHandler, patchPersonHandler } from "@/lib/crm-b2b/people-handler";
import { companyCreateSchema, companyPatchSchema, companyPersonCreateSchema, companyPersonPatchSchema, personCreateSchema, personPatchSchema } from "@/lib/crm-b2b/schemas";
import { moduloLigado } from "@/lib/instalacao/modulos";
import type { McpContext, McpToolDefinition } from "../types";

const uuid = z.string().uuid();
const searchShape = { search: z.string().trim().min(1).max(200).optional(), limit: z.number().int().min(1).max(100).default(50) };
const companyId = { company_id: uuid };
const personId = { person_id: uuid };
const linkId = { link_id: uuid };
const batchId = { batch_id: uuid };

function handlerCtx(ctx: McpContext): HandlerCtx {
  return { organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId };
}

/** created_by é FK auth.users; o ID do token ou do run de IA não serve. */
function humanProvenance(ctx: McpContext): string {
  if (ctx.actor.type === "user") return ctx.actor.id;
  if (ctx.provisionedByUserId) return ctx.provisionedByUserId;
  throw new Error("human_provenance_required");
}

async function requireB2b(ctx: McpContext): Promise<void> {
  if (!(await moduloLigado(ctx.supabase, "crm_b2b"))) throw new Error("crm_b2b_module_disabled");
}

/** Só nomes de campos e presença entram no log universal; nenhum valor pessoal. */
function redactB2b(args: Record<string, unknown>): Record<string, unknown> {
  return {
    id_present: ["company_id", "person_id", "link_id", "batch_id", "contact_id"].some((k) => typeof args[k] === "string"),
    search_present: typeof args.search === "string" && args.search.length > 0,
    fields_present: Object.keys(args).filter((k) => !["company_id", "person_id", "link_id", "batch_id", "contact_id", "search", "limit", "status"].includes(k)).sort(),
    ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
    ...(typeof args.status === "string" ? { status_filter_present: true } : {}),
  };
}

const companyCreateShape = companyCreateSchema.omit({ enrich: true }).shape;
const companyPatchShape = companyPatchSchema.omit({ enrich: true }).shape;
const updateCompanyShape = { ...companyId, ...companyPatchShape };
const updatePersonShape = { ...personId, ...personPatchSchema.shape };
const updateLinkShape = { ...linkId, ...companyPersonPatchSchema.shape };
const contactPersonShape = { contact_id: uuid, person_id: uuid.nullable() };
const getBatchShape = { ...batchId, status: z.enum(["pending", "processing", "success", "conflict", "failed"]).optional() };

export const crmListCompanies: McpToolDefinition<typeof searchShape> = {
  name: "crm_list_companies", description: "Lista empresas B2B da organização do token; busca opcional por nome ou CNPJ.",
  inputSchema: searchShape, category: "read", requiresRole: "agent", requiresScope: "mcp:read", domain: "contacts",
  redigirParaAuditoria: redactB2b, redigirErroParaAuditoria: () => "b2b_tool_error", auditResource: () => ({ type: "companies" }),
  handler: async (input, ctx) => { await requireB2b(ctx); return listCompaniesHandler(ctx.supabase, handlerCtx(ctx), input); },
};

export const crmGetCompany: McpToolDefinition<typeof companyId> = {
  name: "crm_get_company", description: "Obtém empresa B2B e seus vínculos somente na organização do token.",
  inputSchema: companyId, category: "read", requiresRole: "agent", requiresScope: "mcp:read", domain: "contacts",
  redigirParaAuditoria: redactB2b, redigirErroParaAuditoria: () => "b2b_tool_error", auditResource: (input) => ({ type: "companies", id: input.company_id }),
  handler: async (input, ctx) => { await requireB2b(ctx); return getCompanyHandler(ctx.supabase, handlerCtx(ctx), input.company_id); },
};

export const crmCreateCompany: McpToolDefinition<typeof companyCreateShape> = {
  name: "crm_create_company", description: "Cria empresa B2B sem consulta externa automática. O enriquecimento BrasilAPI permanece na rota humana.",
  inputSchema: companyCreateShape, category: "write", requiresRole: "manager", requiresScope: "mcp:write", domain: "contacts",
  redigirParaAuditoria: redactB2b, redigirErroParaAuditoria: () => "b2b_tool_error", auditResource: (_input, result) => ({ type: "companies", id: (result as { id?: string } | undefined)?.id }),
  handler: async (input, ctx) => { await requireB2b(ctx); return createCompanyHandler(ctx.supabase, handlerCtx(ctx), humanProvenance(ctx), { ...input, enrich: false }); },
};

export const crmUpdateCompany: McpToolDefinition<typeof updateCompanyShape> = {
  name: "crm_update_company", description: "Atualiza empresa B2B do tenant sem disparar enriquecimento externo.",
  inputSchema: updateCompanyShape, category: "write", requiresRole: "manager", requiresScope: "mcp:write", domain: "contacts",
  redigirParaAuditoria: redactB2b, redigirErroParaAuditoria: () => "b2b_tool_error", auditResource: (input) => ({ type: "companies", id: input.company_id }),
  handler: async ({ company_id, ...patch }, ctx) => { await requireB2b(ctx); return patchCompanyHandler(ctx.supabase, handlerCtx(ctx), humanProvenance(ctx), company_id, { ...patch, enrich: false }); },
};

export const crmListPeople: McpToolDefinition<typeof searchShape> = {
  name: "crm_list_people", description: "Lista pessoas B2B da organização do token; busca opcional por nome ou email.",
  inputSchema: searchShape, category: "read", requiresRole: "agent", requiresScope: "mcp:read", domain: "contacts",
  redigirParaAuditoria: redactB2b, redigirErroParaAuditoria: () => "b2b_tool_error", auditResource: () => ({ type: "people" }),
  handler: async (input, ctx) => { await requireB2b(ctx); return listPeopleHandler(ctx.supabase, handlerCtx(ctx), input); },
};

export const crmGetPerson: McpToolDefinition<typeof personId> = {
  name: "crm_get_person", description: "Obtém pessoa B2B, empresas e contatos ligados somente no tenant do token.",
  inputSchema: personId, category: "read", requiresRole: "agent", requiresScope: "mcp:read", domain: "contacts",
  redigirParaAuditoria: redactB2b, redigirErroParaAuditoria: () => "b2b_tool_error", auditResource: (input) => ({ type: "people", id: input.person_id }),
  handler: async (input, ctx) => { await requireB2b(ctx); return getPersonHandler(ctx.supabase, handlerCtx(ctx), input.person_id); },
};

const personCreateShape = personCreateSchema.omit({ company_id: true, job_title: true, department: true, is_decision_maker: true, is_primary: true }).shape;
export const crmCreatePerson: McpToolDefinition<typeof personCreateShape> = {
  name: "crm_create_person", description: "Cria pessoa B2B; vincule a uma empresa em uma chamada explícita depois.",
  inputSchema: personCreateShape, category: "write", requiresRole: "manager", requiresScope: "mcp:write", domain: "contacts",
  redigirParaAuditoria: redactB2b, redigirErroParaAuditoria: () => "b2b_tool_error", auditResource: (_input, result) => ({ type: "people", id: (result as { id?: string } | undefined)?.id }),
  handler: async (input, ctx) => { await requireB2b(ctx); return createPersonHandler(ctx.supabase, handlerCtx(ctx), humanProvenance(ctx), input); },
};

export const crmUpdatePerson: McpToolDefinition<typeof updatePersonShape> = {
  name: "crm_update_person", description: "Atualiza uma pessoa B2B existente na organização do token.",
  inputSchema: updatePersonShape, category: "write", requiresRole: "manager", requiresScope: "mcp:write", domain: "contacts",
  redigirParaAuditoria: redactB2b, redigirErroParaAuditoria: () => "b2b_tool_error", auditResource: (input) => ({ type: "people", id: input.person_id }),
  handler: async ({ person_id, ...patch }, ctx) => { await requireB2b(ctx); return patchPersonHandler(ctx.supabase, handlerCtx(ctx), humanProvenance(ctx), person_id, patch); },
};

export const crmLinkCompanyPerson: McpToolDefinition<typeof companyPersonCreateSchema.shape> = {
  name: "crm_link_company_person", description: "Vincula pessoa e empresa do mesmo tenant; duplicidade vira conflito.",
  inputSchema: companyPersonCreateSchema.shape, category: "write", requiresRole: "manager", requiresScope: "mcp:write", domain: "contacts",
  redigirParaAuditoria: redactB2b, redigirErroParaAuditoria: () => "b2b_tool_error", auditResource: (_input, result) => ({ type: "company_people", id: (result as { id?: string } | undefined)?.id }),
  handler: async (input, ctx) => { await requireB2b(ctx); return linkCompanyPersonHandler(ctx.supabase, handlerCtx(ctx), humanProvenance(ctx), input); },
};

export const crmUpdateCompanyPerson: McpToolDefinition<typeof updateLinkShape> = {
  name: "crm_update_company_person", description: "Atualiza cargo, departamento e atributos de um vínculo B2B do tenant.",
  inputSchema: updateLinkShape, category: "write", requiresRole: "manager", requiresScope: "mcp:write", domain: "contacts",
  redigirParaAuditoria: redactB2b, redigirErroParaAuditoria: () => "b2b_tool_error", auditResource: (input) => ({ type: "company_people", id: input.link_id }),
  handler: async ({ link_id, ...patch }, ctx) => { await requireB2b(ctx); return patchCompanyPersonHandler(ctx.supabase, handlerCtx(ctx), humanProvenance(ctx), link_id, patch); },
};

export const crmLinkContactPerson: McpToolDefinition<typeof contactPersonShape> = {
  name: "crm_link_contact_person", description: "Associa ou remove um contato de uma pessoa B2B do mesmo tenant.",
  inputSchema: contactPersonShape, category: "write", requiresRole: "manager", requiresScope: "mcp:write", domain: "contacts",
  redigirParaAuditoria: redactB2b, redigirErroParaAuditoria: () => "b2b_tool_error", auditResource: (input) => ({ type: "contacts", id: input.contact_id }),
  handler: async (input, ctx) => { await requireB2b(ctx); return linkContactToPersonHandler(ctx.supabase, handlerCtx(ctx), humanProvenance(ctx), input.contact_id, input.person_id); },
};

export const crmListImportBatches: McpToolDefinition = {
  name: "crm_list_import_batches", description: "Lista lotes de importação B2B da organização do token, sem upload de arquivo.",
  inputSchema: {}, category: "read", requiresRole: "agent", requiresScope: "mcp:read", domain: "contacts",
  redigirParaAuditoria: redactB2b, redigirErroParaAuditoria: () => "b2b_tool_error", auditResource: () => ({ type: "import_batches" }),
  handler: async (_input, ctx) => { await requireB2b(ctx); return listImportBatchesHandler(ctx.supabase, handlerCtx(ctx)); },
};

export const crmGetImportBatch: McpToolDefinition<typeof getBatchShape> = {
  name: "crm_get_import_batch", description: "Obtém lote e linhas B2B no tenant; pode filtrar por status. Não inicia importação.",
  inputSchema: getBatchShape,
  category: "read", requiresRole: "agent", requiresScope: "mcp:read", domain: "contacts",
  redigirParaAuditoria: redactB2b, redigirErroParaAuditoria: () => "b2b_tool_error", auditResource: (input) => ({ type: "import_batches", id: input.batch_id }),
  handler: async (input, ctx) => { await requireB2b(ctx); return getImportBatchHandler(ctx.supabase, handlerCtx(ctx), input.batch_id, input.status); },
};

export const B2B_MCP_TOOLS = [
  crmListCompanies, crmGetCompany, crmCreateCompany, crmUpdateCompany,
  crmListPeople, crmGetPerson, crmCreatePerson, crmUpdatePerson,
  crmLinkCompanyPerson, crmUpdateCompanyPerson, crmLinkContactPerson,
  crmListImportBatches, crmGetImportBatch,
] as unknown as ReadonlyArray<McpToolDefinition>;
