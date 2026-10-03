import { z } from "zod";
import type { McpContext, McpToolDefinition, McpToolDomain } from "../types";
import { capacidadesDaOrganizacao } from "@/lib/organizacao/capacidades";
import {
  documentoCampoSchema,
  documentoSecaoSchema,
  getProposalDocumentHandler,
  updateProposalDocumentHandler,
} from "@/lib/propostas/documento/administracao";
import {
  revisionCreateSchema,
  createProposalRevisionHandler,
} from "@/lib/propostas/revisao-administrativa";
import { discardDraftProposalHandler } from "@/lib/propostas/administracao";
import { listarModelosDaOrganizacao } from "@/lib/propostas/modelos/catalogo-da-organizacao";
import {
  templatePostSchema,
  writeProposalTemplateHandler,
} from "@/lib/propostas/modelos/escrita-administrativa";
import {
  templatePatchSchema,
  getProposalTemplateHandler,
  updateProposalTemplateHandler,
  deactivateProposalTemplateHandler,
} from "@/lib/propostas/modelos/administracao";
import {
  proposalDefaultsSchema,
  getProposalSettingsHandler,
  updateProposalSettingsHandler,
} from "@/lib/propostas/configuracao-administrativa";

const proposal = { proposal_id: z.string().uuid() };
const template = { template_slug: z.string().min(1).max(100) };
const context = (ctx: McpContext) => ({
  organization_id: ctx.organizationId,
  actor: ctx.actor,
  requestId: ctx.requestId,
});
/** Redige somente nomes conhecidos; nunca nomes/slug/caminhos livres nem erro cru. */
const safeFields = new Set([
  "motivo",
  "campo",
  "valor",
  "secaoId",
  "texto",
  "nome",
  "descricao",
  "sections",
  "section_order",
  "default_valid_days",
  "default_conditions",
  "visible",
]);
function redaction(args: Record<string, unknown>) {
  return {
    proposal_id_present: !!args.proposal_id,
    template_slug_present: !!args.template_slug || !!args.base_slug,
    ...(Array.isArray(args.sections) ? { section_count: args.sections.length } : {}),
    fields_changed: Object.keys(args)
      .filter((key) => safeFields.has(key))
      .sort(),
  };
}
// Pequena declaração comum: cada ação mantém schema e handler específicos.
function tool<S extends z.ZodRawShape>(spec: {
  name: string;
  description: string;
  inputSchema: S;
  category: "read" | "write";
  domain: McpToolDomain;
  handler: McpToolDefinition<S>["handler"];
  destructive?: boolean;
}): McpToolDefinition<S> {
  const {
    name,
    description,
    inputSchema: schema,
    category,
    domain,
    handler,
    destructive = false,
  } = spec;
  return {
    name,
    description,
    inputSchema: schema,
    category,
    domain,
    requiresRole: "manager",
    requiresScope: category === "read" ? "mcp:read" : "mcp:write",
    capabilities: destructive ? ["destructive_operations"] : [],
    redigirParaAuditoria: redaction,
    redigirErroParaAuditoria: () => "proposal_administration_error",
    auditResource: () => ({
      type:
        domain === "templates"
          ? "proposal_templates"
          : domain === "settings"
            ? "organization"
            : "crm_proposals",
    }),
    handler: async (raw, ctx) => {
      if (!(await capacidadesDaOrganizacao(ctx.supabase, ctx.organizationId)).includes("propostas"))
        throw new Error("proposals_capability_disabled");
      return handler(z.object(schema).strict().parse(raw), ctx);
    },
  };
}
export const crmGetProposalDocument = tool({
  name: "crm_get_proposal_document",
  description:
    "Obtém seções, pendências e prontidão do documento como dados estruturados da organização. Não gera PDF nem arquivo.",
  inputSchema: proposal,
  category: "read",
  domain: "operations",
  handler: (input, ctx) =>
    getProposalDocumentHandler(ctx.supabase, context(ctx), input.proposal_id),
});
export const crmUpdateProposalDocumentField = tool({
  name: "crm_update_proposal_document_field",
  description:
    "Preenche um campo permitido de briefing num rascunho, conforme o modelo confirmado pela pessoa. Não gera nem aplica sugestão de IA.",
  inputSchema: { ...proposal, ...documentoCampoSchema.shape },
  category: "write",
  domain: "operations",
  handler: (input, ctx) =>
    updateProposalDocumentHandler(ctx.supabase, context(ctx), input.proposal_id, input),
});
export const crmUpdateProposalDocumentSection = tool({
  name: "crm_update_proposal_document_section",
  description:
    "Edita seção de documento em rascunho; texto nulo restaura o modelo. Não altera proposta enviada nem confirma modelo.",
  inputSchema: { ...proposal, ...documentoSecaoSchema.shape },
  category: "write",
  domain: "operations",
  handler: (input, ctx) =>
    updateProposalDocumentHandler(ctx.supabase, context(ctx), input.proposal_id, input),
});
export const crmCreateProposalRevision = tool({
  name: "crm_create_proposal_revision",
  description:
    "Cria novo rascunho de uma proposta enviada, herdando cadeia e moeda e reprecificando itens. A versão anterior permanece enviada. Um rascunho por negócio; não repetir resposta incerta.",
  inputSchema: { ...proposal, ...revisionCreateSchema.shape },
  category: "write",
  domain: "operations",
  handler: (input, ctx) =>
    createProposalRevisionHandler(
      ctx.supabase,
      context(ctx),
      input.proposal_id,
      input.motivo ?? null,
    ),
});
export const crmDiscardDraftProposal = tool({
  name: "crm_discard_draft_proposal",
  description:
    "Cancela exclusivamente um rascunho interno; preserva histórico e versões enviadas. Não envia mensagem nem exclui fisicamente.",
  inputSchema: proposal,
  category: "write",
  domain: "operations",
  handler: (input, ctx) =>
    discardDraftProposalHandler(ctx.supabase, context(ctx), input.proposal_id),
  destructive: true,
});
export const crmListProposalTemplates = tool({
  name: "crm_list_proposal_templates",
  description:
    "Lista modelos completos de administração da organização, com origem e visibilidade, incluindo bases ocultas.",
  inputSchema: {},
  category: "read",
  domain: "templates",
  handler: (_input, ctx) => listarModelosDaOrganizacao(ctx.supabase, ctx.organizationId),
});
export const crmGetProposalTemplate = tool({
  name: "crm_get_proposal_template",
  description:
    "Obtém estrutura e versão do modelo da organização ou da base pública, sem ler cópias de outra organização.",
  inputSchema: template,
  category: "read",
  domain: "templates",
  handler: (input, ctx) =>
    getProposalTemplateHandler(ctx.supabase, context(ctx), input.template_slug),
});
const create = z.object({
  nome: z.string().max(200),
  descricao: z.string().max(300).nullable().optional(),
  sections: templatePatchSchema.shape.sections.optional(),
  section_order: templatePatchSchema.shape.section_order.optional(),
});
export const crmCreateProposalTemplate = tool({
  name: "crm_create_proposal_template",
  description:
    "Cria modelo interno estruturado e validado na organização. Não importa arquivo, chama IA ou confirma modelo numa proposta. Não repetir resposta incerta.",
  inputSchema: create.shape,
  category: "write",
  domain: "templates",
  handler: (input, ctx) =>
    writeProposalTemplateHandler(
      ctx.supabase,
      context(ctx),
      templatePostSchema.parse({ ...input, acao: "novo" }),
    ),
});
export const crmCustomizeProposalTemplate = tool({
  name: "crm_customize_proposal_template",
  description:
    "Cria uma cópia organizacional de um modelo público para edição interna; não confirma seleção numa proposta.",
  inputSchema: template,
  category: "write",
  domain: "templates",
  handler: (input, ctx) =>
    writeProposalTemplateHandler(ctx.supabase, context(ctx), {
      acao: "personalizar",
      base_slug: input.template_slug,
    }),
});
export const crmSetProposalTemplateVisibility = tool({
  name: "crm_set_proposal_template_visibility",
  description:
    "Mostra ou oculta uma base pública no seletor desta organização, preservando propostas e configuração global.",
  inputSchema: { ...template, visible: z.boolean() },
  category: "write",
  domain: "templates",
  handler: (input, ctx) =>
    writeProposalTemplateHandler(ctx.supabase, context(ctx), {
      acao: input.visible ? "mostrar" : "ocultar",
      slug: input.template_slug,
    }),
});
export const crmUpdateProposalTemplate = tool({
  name: "crm_update_proposal_template",
  description:
    "Edita e versiona somente cópia ativa desta organização com validação canônica de seções e variáveis. Não altera modelo global.",
  inputSchema: { ...template, ...templatePatchSchema.shape },
  category: "write",
  domain: "templates",
  handler: (input, ctx) =>
    updateProposalTemplateHandler(ctx.supabase, context(ctx), input.template_slug, input),
});
export const crmDeactivateProposalTemplate = tool({
  name: "crm_deactivate_proposal_template",
  description:
    "Desativa a cópia ativa da organização, preservando registros; uma base pública volta a resolver por fallback. Não apaga histórico.",
  inputSchema: template,
  category: "write",
  domain: "templates",
  handler: (input, ctx) =>
    deactivateProposalTemplateHandler(ctx.supabase, context(ctx), input.template_slug),
  destructive: true,
});
export const crmGetProposalSettings = tool({
  name: "crm_get_proposal_settings",
  description:
    "Consulta configurações de Propostas somente da organização autorizada, com capacidade Propostas ativa.",
  inputSchema: {},
  category: "read",
  domain: "settings",
  handler: (_input, ctx) => getProposalSettingsHandler(ctx.supabase, context(ctx)),
});
export const crmUpdateProposalDefaults = tool({
  name: "crm_update_proposal_defaults",
  description:
    "Atualiza apenas validade padrão e condições comerciais da organização. Preserva ativação, orçamento, followup e WhatsApp; sem efeito externo.",
  inputSchema: proposalDefaultsSchema.shape,
  category: "write",
  domain: "settings",
  handler: (input, ctx) =>
    updateProposalSettingsHandler(ctx.supabase, context(ctx), proposalDefaultsSchema.parse(input)),
});
export const PROPOSTAS_ADMINISTRACAO_MCP_TOOLS = [
  crmGetProposalDocument,
  crmUpdateProposalDocumentField,
  crmUpdateProposalDocumentSection,
  crmCreateProposalRevision,
  crmDiscardDraftProposal,
  crmListProposalTemplates,
  crmGetProposalTemplate,
  crmCreateProposalTemplate,
  crmCustomizeProposalTemplate,
  crmSetProposalTemplateVisibility,
  crmUpdateProposalTemplate,
  crmDeactivateProposalTemplate,
  crmGetProposalSettings,
  crmUpdateProposalDefaults,
] as unknown as ReadonlyArray<McpToolDefinition>;
