import { DELTA_162_READ_TOOLS } from "./delta-162-leituras";
import { PROPOSTAS_ADMINISTRACAO_MCP_TOOLS } from "./propostas-administracao";
import { z } from "zod";
import type { McpContext, McpToolDefinition } from "../types";
import { getTagsReportHandler, tagsReportQuerySchema } from "@/lib/reports/tags";
import {
  listHonorariosContratosHandler,
  contratoCreateSchema,
  parcelaCreateSchema,
  createHonorariosContratoHandler,
  createHonorariosParcelaHandler,
} from "@/lib/honorarios/handlers";
import { capacidadesDaOrganizacao } from "@/lib/organizacao/capacidades";
import {
  listProposalsHandler,
  getProposalHandler,
  updateDraftProposalHandler,
  proposalPatchSchema,
} from "@/lib/propostas/administracao";
import { moduloLigado } from "@/lib/instalacao/modulos";

const handlerCtx = (ctx: McpContext) => ({
  organization_id: ctx.organizationId,
  actor: ctx.actor,
  requestId: ctx.requestId,
});
const redaction = (args: Record<string, unknown>) => ({
  fields_present: Object.keys(args).sort(),
  tags_filter_present: typeof args.tags === "string" && args.tags.length > 0,
});
async function requireHonorarios(ctx: McpContext) {
  if (!(await moduloLigado(ctx.supabase, "honorarios")))
    throw new Error("honorarios_module_disabled");
}

export const crmGetTagsReport: McpToolDefinition<typeof tagsReportQuerySchema.shape> = {
  name: "crm_get_tags_report",
  description:
    "Consulta volume, desfecho e espera por etiqueta de conversa, em janela de até 90 dias e fuso do leitor. Declara ausência de dados e truncamento. Requer manager para o agregado da organização.",
  inputSchema: tagsReportQuerySchema.shape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "conversations",
  redigirParaAuditoria: redaction,
  redigirErroParaAuditoria: () => "tags_report_error",
  auditResource: () => ({ type: "conversation_tags_report" }),
  handler: (input, ctx) =>
    getTagsReportHandler(ctx.supabase, ctx.organizationId, input, ctx.requestId),
};

export const crmCreateHonorariosContrato: McpToolDefinition<typeof contratoCreateSchema.shape> = {
  name: "crm_create_honorarios_contrato",
  description:
    "Registra um contrato interno de honorários fixos, de êxito ou mistos. Não gera cobrança nem pagamento. A criação não é idempotente: não repita automaticamente uma resposta incerta.",
  inputSchema: contratoCreateSchema.shape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "operations",
  redigirParaAuditoria: redaction,
  redigirErroParaAuditoria: () => "honorarios_tool_error",
  auditResource: (_input, result) => ({
    type: "honorarios_contrato",
    id: (result as { id?: string })?.id,
  }),
  handler: async (input, ctx) => {
    await requireHonorarios(ctx);
    return createHonorariosContratoHandler(ctx.supabase, handlerCtx(ctx), input);
  },
};

const parcelaShape = { contrato_id: z.string().uuid(), ...parcelaCreateSchema.shape };
export const crmCreateHonorariosParcela: McpToolDefinition<typeof parcelaShape> = {
  name: "crm_create_honorarios_parcela",
  description:
    "Registra uma parcela pendente no calendário interno de honorários. Não movimenta dinheiro nem emite PIX/boleto/cartão. Número repetido no contrato é conflito; não repita automaticamente uma resposta incerta.",
  inputSchema: parcelaShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "operations",
  redigirParaAuditoria: redaction,
  redigirErroParaAuditoria: () => "honorarios_tool_error",
  auditResource: (_input, result) => ({
    type: "honorarios_parcela",
    id: (result as { id?: string })?.id,
  }),
  handler: async (input, ctx) => {
    await requireHonorarios(ctx);
    return createHonorariosParcelaHandler(ctx.supabase, handlerCtx(ctx), input.contrato_id, input);
  },
};

const contratosListShape = { lead_id: z.string().uuid().optional() };
export const crmListHonorariosContratos: McpToolDefinition<typeof contratosListShape> = {
  name: "crm_list_honorarios_contratos",
  description:
    "Lista até 200 contratos internos do tenant, com lead opcional. Não emite cobrança nem movimenta dinheiro.",
  inputSchema: contratosListShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "operations",
  redigirParaAuditoria: (args) => ({ lead_id_present: !!args.lead_id }),
  redigirErroParaAuditoria: () => "honorarios_tool_error",
  auditResource: () => ({ type: "honorarios_contrato" }),
  handler: async (input, ctx) => {
    await requireHonorarios(ctx);
    const parsed = z.object(contratosListShape).parse(input);
    return listHonorariosContratosHandler(ctx.supabase, handlerCtx(ctx), parsed.lead_id);
  },
};
const proposalListShape = {
  status: z
    .enum([
      "rascunho",
      "enviando",
      "enviada",
      "aceita",
      "recusada",
      "cancelada",
      "substituida",
      "vencida",
    ])
    .optional(),
  lead_id: z.string().uuid().optional(),
};
const proposalGetShape = { proposal_id: z.string().uuid() };
const proposalUpdateShape = { ...proposalGetShape, ...proposalPatchSchema.shape };
const proposalRedaction = (args: Record<string, unknown>) => ({
  proposal_id_present: !!args.proposal_id,
  lead_id_present: !!args.lead_id,
  status_filter_present: !!args.status,
  ...(typeof args.revision === "number" ? { revision: args.revision } : {}),
  ...(Array.isArray(args.itens) ? { item_count: args.itens.length } : {}),
  campos_alterados: Object.keys(args)
    .filter((key) => key in proposalPatchSchema.shape)
    .sort(),
});
const proposalCommon = {
  requiresRole: "manager" as const,
  domain: "operations" as const,
  redigirParaAuditoria: proposalRedaction,
  redigirErroParaAuditoria: () => "proposal_tool_error",
  auditResource: () => ({ type: "crm_proposals" }),
};
async function requireProposals(ctx: McpContext) {
  if (!(await capacidadesDaOrganizacao(ctx.supabase, ctx.organizationId)).includes("propostas"))
    throw new Error("proposals_capability_disabled");
}
export const crmListProposals: McpToolDefinition<typeof proposalListShape> = {
  ...proposalCommon,
  name: "crm_list_proposals",
  category: "read",
  requiresScope: "mcp:read",
  description:
    "Lista até 500 propostas da organização do token, filtradas por status e lead quando informados.",
  inputSchema: proposalListShape,
  handler: async (input, ctx) => {
    await requireProposals(ctx);
    return listProposalsHandler(
      ctx.supabase,
      handlerCtx(ctx),
      z.object(proposalListShape).parse(input),
    );
  },
};
export const crmGetProposal: McpToolDefinition<typeof proposalGetShape> = {
  ...proposalCommon,
  name: "crm_get_proposal",
  category: "read",
  requiresScope: "mcp:read",
  description:
    "Obtém uma proposta do tenant com itens ordenados e preço atual do catálogo para detectar alterações.",
  inputSchema: proposalGetShape,
  handler: async (input, ctx) => {
    await requireProposals(ctx);
    return getProposalHandler(
      ctx.supabase,
      handlerCtx(ctx),
      z.object(proposalGetShape).parse(input).proposal_id,
    );
  },
};
export const crmUpdateDraftProposal: McpToolDefinition<typeof proposalUpdateShape> = {
  ...proposalCommon,
  name: "crm_update_draft_proposal",
  category: "write",
  requiresScope: "mcp:write",
  description:
    "Edita exclusivamente rascunho com revisão otimista, preservando moeda e recalculando itens e total. Não envia nem aceita proposta. Recarregue após conflito.",
  inputSchema: proposalUpdateShape,
  handler: async (input, ctx) => {
    await requireProposals(ctx);
    const parsed = z.object(proposalUpdateShape).parse(input);
    return updateDraftProposalHandler(ctx.supabase, handlerCtx(ctx), parsed.proposal_id, parsed);
  },
};

export const PARITY_162_MCP_TOOLS = [
  ...PROPOSTAS_ADMINISTRACAO_MCP_TOOLS,
  ...DELTA_162_READ_TOOLS,
  crmGetTagsReport,
  crmCreateHonorariosContrato,
  crmCreateHonorariosParcela,
  crmListHonorariosContratos,
  crmListProposals,
  crmGetProposal,
  crmUpdateDraftProposal,
] as unknown as ReadonlyArray<McpToolDefinition>;
