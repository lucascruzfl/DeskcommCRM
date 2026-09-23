import { z } from "zod";

import { CONFIGURACAO_PADRAO, configuracaoDeCampanhasSchema, lerConfiguracao } from "@/lib/campanhas/configuracao";
import { enderecoValido, finalDoEndereco, hashDoEndereco } from "@/lib/campanhas/exclusoes";
import { criarExclusaoSchema, criarTemplateSchema, editarTemplateSchema } from "@/lib/campanhas/schemas";
import { McpToolError } from "@/lib/mcp/errors";
import type { McpToolDefinition } from "@/lib/mcp/types";

const uuid = z.string().uuid();
const idShape = { id: uuid };

function fail(message: string): never {
  throw new McpToolError("provider_unavailable", message);
}

const listRecipientsShape = { campaign_id: uuid, limit: z.number().int().min(1).max(100).default(50) };
const listRecipients: McpToolDefinition<typeof listRecipientsShape> = {
  name: "crm_list_campaign_recipients", description: "Lista destinatários e estados, sem expor telefones.",
  inputSchema: listRecipientsShape, category: "read", requiresRole: "manager", requiresScope: "mcp:read", domain: "campaigns",
  handler: async (input, ctx) => {
    const { data: campaign } = await ctx.supabase.from("campaigns").select("id")
      .eq("organization_id", ctx.organizationId).eq("id", input.campaign_id).maybeSingle();
    if (!campaign) throw new McpToolError("not_found", "Campanha não encontrada.");
    const { data, error } = await ctx.supabase.from("campaign_recipients")
      .select("id, contact_id, status, eligibility_status, exclusion_reason, sent_at, delivered_at, read_at, replied_at, opted_out_at, last_error_code, created_at")
      .eq("organization_id", ctx.organizationId).eq("campaign_id", input.campaign_id)
      .order("created_at", { ascending: true }).limit(input.limit);
    if (error) fail("Não consegui consultar os destinatários.");
    return { recipients: data ?? [] };
  },
};

const listTemplates: McpToolDefinition = {
  name: "crm_list_campaign_templates", description: "Lista os textos salvos para campanhas da organização.",
  inputSchema: {}, category: "read", requiresRole: "manager", requiresScope: "mcp:read", domain: "campaigns",
  handler: async (_input, ctx) => {
    const { data, error } = await ctx.supabase.from("campaign_templates")
      .select("id, name, body, created_at, updated_at")
      .eq("organization_id", ctx.organizationId).order("name").limit(200);
    if (error) fail("Não consegui consultar os textos salvos.");
    return { templates: data ?? [] };
  },
};

const createTemplate: McpToolDefinition<typeof criarTemplateSchema.shape> = {
  name: "crm_create_campaign_template", description: "Salva um texto de campanha sem alterar envios já preparados.",
  inputSchema: criarTemplateSchema.shape, category: "write", requiresRole: "manager", requiresScope: "mcp:write", domain: "campaigns",
  redigirParaAuditoria: (input) => ({ name: input.name }),
  auditResource: (_input, result) => ({ type: "campaign_template", id: (result as { template?: { id?: string } })?.template?.id }),
  handler: async (input, ctx) => {
    const parsed = criarTemplateSchema.parse(input);
    const { data, error } = await ctx.supabase.from("campaign_templates").insert({
      organization_id: ctx.organizationId, ...parsed,
      created_by: ctx.provisionedByUserId ?? null, updated_by: ctx.provisionedByUserId ?? null,
    }).select("id, name, body, created_at, updated_at").single();
    if (error || !data) fail("Não consegui salvar o texto de campanha.");
    return { template: data };
  },
};

const editTemplateShape = { id: uuid, ...editarTemplateSchema.shape };
const editTemplate: McpToolDefinition<typeof editTemplateShape> = {
  name: "crm_update_campaign_template", description: "Edita um texto salvo, sem alterar campanhas já preparadas.",
  inputSchema: editTemplateShape, category: "write", requiresRole: "manager", requiresScope: "mcp:write", domain: "campaigns",
  redigirParaAuditoria: (input) => ({ id: input.id, fields: Object.keys(input).filter((key) => key !== "id") }),
  auditResource: (input) => ({ type: "campaign_template", id: input.id }),
  handler: async (input, ctx) => {
    const { id, ...changes } = input;
    const parsed = editarTemplateSchema.parse(changes);
    const { data, error } = await ctx.supabase.from("campaign_templates")
      .update({ ...parsed, updated_by: ctx.provisionedByUserId ?? null })
      .eq("organization_id", ctx.organizationId).eq("id", id)
      .select("id, name, body, created_at, updated_at").maybeSingle();
    if (error) fail("Não consegui alterar o texto de campanha.");
    if (!data) throw new McpToolError("not_found", "Texto não encontrado.");
    return { template: data };
  },
};

const deleteTemplate: McpToolDefinition<typeof idShape> = {
  name: "crm_delete_campaign_template", description: "Remove um texto salvo, sem tocar em campanhas existentes.",
  inputSchema: idShape, category: "write", requiresRole: "manager", requiresScope: "mcp:write", domain: "campaigns",
  capabilities: ["destructive_operations"], auditResource: (input) => ({ type: "campaign_template", id: input.id }),
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase.from("campaign_templates").delete()
      .eq("organization_id", ctx.organizationId).eq("id", input.id).select("id").maybeSingle();
    if (error) fail("Não consegui remover o texto de campanha.");
    if (!data) throw new McpToolError("not_found", "Texto não encontrado.");
    return { id: input.id };
  },
};

const listSuppressions: McpToolDefinition = {
  name: "crm_list_campaign_suppressions", description: "Lista exclusões de campanhas com somente os últimos dígitos do telefone.",
  inputSchema: {}, category: "read", requiresRole: "manager", requiresScope: "mcp:read", domain: "campaigns",
  handler: async (_input, ctx) => {
    const { data, error } = await ctx.supabase.from("campaign_suppressions")
      .select("id, contact_id, address_tail, reason, source, created_at")
      .eq("organization_id", ctx.organizationId).order("created_at", { ascending: false }).limit(500);
    if (error) fail("Não consegui consultar exclusões de campanhas.");
    return { suppressions: data ?? [] };
  },
};

const addSuppression: McpToolDefinition<typeof criarExclusaoSchema.shape> = {
  name: "crm_add_campaign_suppression", description: "Adiciona um telefone à lista de exclusões, armazenando apenas hash e sufixo.",
  inputSchema: criarExclusaoSchema.shape, category: "write", requiresRole: "manager", requiresScope: "mcp:write", domain: "campaigns",
  redigirParaAuditoria: () => ({ address: "[redacted]" }),
  handler: async (input, ctx) => {
    const parsed = criarExclusaoSchema.parse(input);
    if (!enderecoValido(parsed.address)) throw new McpToolError("validation_error", "Telefone fora do formato de envio.");
    const { data, error } = await ctx.supabase.from("campaign_suppressions").insert({
      organization_id: ctx.organizationId, contact_id: parsed.contact_id ?? null,
      recipient_address_hash: hashDoEndereco(parsed.address), address_tail: finalDoEndereco(parsed.address),
      reason: parsed.reason ?? null, source: "manual", created_by: ctx.provisionedByUserId ?? null,
    }).select("id, address_tail, reason, created_at").single();
    if (error?.code === "23505") return { already_present: true };
    if (error || !data) fail("Não consegui adicionar a exclusão.");
    return { suppression: data };
  },
};

const removeSuppression: McpToolDefinition<typeof idShape> = {
  name: "crm_remove_campaign_suppression", description: "Remove uma exclusão operacional; não desfaz opt-out do titular.",
  inputSchema: idShape, category: "write", requiresRole: "manager", requiresScope: "mcp:write", domain: "campaigns",
  capabilities: ["destructive_operations"], auditResource: (input) => ({ type: "campaign_suppression", id: input.id }),
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase.from("campaign_suppressions").delete()
      .eq("organization_id", ctx.organizationId).eq("id", input.id).select("id").maybeSingle();
    if (error) fail("Não consegui remover a exclusão.");
    if (!data) throw new McpToolError("not_found", "Exclusão não encontrada.");
    return { id: input.id };
  },
};

const getSettings: McpToolDefinition = {
  name: "crm_get_campaign_settings", description: "Consulta os padrões de ritmo e atribuição de campanhas.",
  inputSchema: {}, category: "read", requiresRole: "manager", requiresScope: "mcp:read", domain: "campaigns",
  handler: async (_input, ctx) => {
    const { data, error } = await ctx.supabase.from("organizations").select("settings")
      .eq("id", ctx.organizationId).maybeSingle();
    if (error) fail("Não consegui consultar os padrões de campanhas.");
    return { settings: lerConfiguracao(data?.settings), defaults: CONFIGURACAO_PADRAO };
  },
};

const updateSettings: McpToolDefinition<typeof configuracaoDeCampanhasSchema.shape> = {
  name: "crm_update_campaign_settings", description: "Atualiza os padrões de campanhas sem sobrescrever outras configurações da organização.",
  inputSchema: configuracaoDeCampanhasSchema.shape, category: "write", requiresRole: "manager", requiresScope: "mcp:write", domain: "campaigns",
  auditResource: () => ({ type: "organization" }),
  handler: async (input, ctx) => {
    const parsed = configuracaoDeCampanhasSchema.parse(input);
    if (parsed.janela_inicio_hora !== null && parsed.janela_fim_hora !== null && parsed.janela_fim_hora <= parsed.janela_inicio_hora)
      throw new McpToolError("validation_error", "A janela precisa terminar depois de começar.");
    const { data, error: readError } = await ctx.supabase.from("organizations").select("settings")
      .eq("id", ctx.organizationId).maybeSingle();
    if (readError || !data) fail("Não consegui consultar as configurações atuais.");
    const settings = (data.settings && typeof data.settings === "object") ? data.settings as Record<string, unknown> : {};
    const { error } = await ctx.supabase.from("organizations")
      .update({ settings: { ...settings, campanhas: parsed } }).eq("id", ctx.organizationId);
    if (error) fail("Não consegui atualizar os padrões de campanhas.");
    return { settings: parsed };
  },
};

export const CAMPAIGN_EXTRA_MCP_TOOLS = [listRecipients, listTemplates, createTemplate, editTemplate, deleteTemplate,
  listSuppressions, addSuppression, removeSuppression, getSettings, updateSettings] as unknown as ReadonlyArray<McpToolDefinition>;
