import { z } from "zod";

import { moedaDaOrganizacao } from "@/lib/catalogo/moeda-da-org";
import { McpToolError } from "@/lib/mcp/errors";
import { humanAction } from "@/lib/mcp/human-action";
import {
  COLUNAS_DO_PRODUTO,
  produtoCreateSchema,
  produtoPatchSchema,
} from "@/lib/schemas/produtos";
import { createTemplateSchema, updateTemplateSchema } from "@/lib/schemas/templates";
import type { McpContext, McpToolDefinition } from "@/lib/mcp/types";

const uuid = z.string().uuid();
const TEMPLATE_COLUMNS = "id, title, body, shortcut, owner_user_id, created_at, updated_at";
const ORDER_COLUMNS =
  "id, contact_id, external_id, external_provider, status, total_cents, currency, payment_method, fulfillment_status, tracking_code, ordered_at, created_at, updated_at, is_anonymized";

function falhar(
  code: ConstructorParameters<typeof McpToolError>[0],
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new McpToolError(code, message, details);
}

async function templateDaOrg(ctx: McpContext, id: string) {
  const { data, error } = await ctx.supabase
    .from("message_templates")
    .select(TEMPLATE_COLUMNS)
    .eq("organization_id", ctx.organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error) falhar("not_allowed", "template_read_failed");
  if (!data) falhar("not_found", "Resposta pronta não encontrada.");
  return data;
}

export const crmGetMessageTemplate: McpToolDefinition<{ template_id: typeof uuid }> = {
  name: "crm_get_message_template",
  description:
    "Consulta uma resposta pronta interna. Isto não consulta nem altera templates externos aprovados por provedores.",
  inputSchema: { template_id: uuid },
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  domain: "templates",
  handler: async (input, ctx) => ({ modelo: await templateDaOrg(ctx, input.template_id) }),
};

const templateCreateShape = createTemplateSchema.shape;
export const crmCreateMessageTemplate: McpToolDefinition<typeof templateCreateShape> = {
  name: "crm_create_message_template",
  description:
    "Cria uma resposta pronta interna; não envia mensagem e não solicita aprovação externa.",
  inputSchema: templateCreateShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "templates",
  auditResource: (_input, result) => ({
    type: "message_template",
    id: (result as { modelo?: { id?: string } })?.modelo?.id,
  }),
  handler: async (input, ctx) => {
    if (!input.shared && !ctx.provisionedByUserId)
      falhar(
        "human_action_required",
        "Template pessoal exige um usuário humano associado ao token.",
        humanAction({
          code: "personal_template_human_owner_required",
          reason: "personal_resource_requires_human_identity",
          resource: { type: "message_template" },
          instruction:
            "Crie o modelo pessoal pela tela ou use shared=true para um modelo da empresa.",
          href: "/app/templates",
        }),
      );
    const { data, error } = await ctx.supabase
      .from("message_templates")
      .insert({
        organization_id: ctx.organizationId,
        title: input.title,
        body: input.body,
        shortcut: input.shortcut ?? null,
        owner_user_id: input.shared ? null : ctx.provisionedByUserId,
      })
      .select(TEMPLATE_COLUMNS)
      .single();
    if (error?.code === "23505")
      falhar("conflict", "Já existe uma resposta pronta com esse atalho.");
    if (error || !data) falhar("not_allowed", "Não foi possível criar a resposta pronta.");
    return { modelo: data };
  },
};

// A forma explícita mantém a validação do contrato HTTP sem aceitar objeto vazio.
const templatePatchShape = {
  template_id: uuid,
  title: z.string().trim().min(1).max(80).optional(),
  body: z.string().trim().min(1).max(4096).optional(),
  shortcut: z.string().trim().min(1).max(40).nullable().optional(),
};
export const crmUpdateMessageTemplate: McpToolDefinition<typeof templatePatchShape> = {
  name: "crm_update_message_template",
  description: "Atualiza título, corpo ou atalho de uma resposta pronta sem disparar envio.",
  inputSchema: templatePatchShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "templates",
  auditResource: (input) => ({ type: "message_template", id: input.template_id }),
  handler: async (input, ctx) => {
    await templateDaOrg(ctx, input.template_id);
    const patch = { ...input } as Record<string, unknown>;
    delete patch.template_id;
    if (Object.keys(patch).length === 0) falhar("validation_error", "Informe ao menos um campo.");
    const parsed = updateTemplateSchema.safeParse(patch);
    if (!parsed.success) falhar("validation_error", "Campos do template inválidos.");
    const { data, error } = await ctx.supabase
      .from("message_templates")
      .update(parsed.data)
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.template_id)
      .select(TEMPLATE_COLUMNS)
      .single();
    if (error?.code === "23505")
      falhar("conflict", "Já existe uma resposta pronta com esse atalho.");
    if (error || !data) falhar("not_allowed", "Não foi possível atualizar a resposta pronta.");
    return { modelo: data };
  },
};

export const crmDuplicateMessageTemplate: McpToolDefinition<{
  template_id: typeof uuid;
  title: z.ZodOptional<z.ZodString>;
}> = {
  name: "crm_duplicate_message_template",
  description: "Duplica uma resposta pronta como compartilhada, sem enviar seu conteúdo.",
  inputSchema: { template_id: uuid, title: z.string().trim().min(1).max(80).optional() },
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "templates",
  auditResource: (_input, result) => ({
    type: "message_template",
    id: (result as { modelo?: { id?: string } })?.modelo?.id,
  }),
  handler: async (input, ctx) => {
    const original = (await templateDaOrg(ctx, input.template_id)) as Record<string, unknown>;
    const { data, error } = await ctx.supabase
      .from("message_templates")
      .insert({
        organization_id: ctx.organizationId,
        title: input.title ?? `${String(original.title)} (cópia)`,
        body: original.body,
        shortcut: null,
        owner_user_id: null,
      })
      .select(TEMPLATE_COLUMNS)
      .single();
    if (error || !data) falhar("not_allowed", "Não foi possível duplicar a resposta pronta.");
    return { modelo: data, duplicated_from: input.template_id };
  },
};

export const crmDeleteMessageTemplate: McpToolDefinition<{ template_id: typeof uuid }> = {
  name: "crm_delete_message_template",
  description: "Exclui uma resposta pronta interna. Não afeta mensagens já enviadas.",
  inputSchema: { template_id: uuid },
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "templates",
  capabilities: ["destructive_operations"],
  auditResource: (input) => ({ type: "message_template", id: input.template_id }),
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("message_templates")
      .delete()
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.template_id)
      .select("id")
      .maybeSingle();
    if (error) falhar("not_allowed", "Não foi possível excluir a resposta pronta.");
    if (!data) falhar("not_found", "Resposta pronta não encontrada.");
    return { id: input.template_id, deleted: true };
  },
};

export const crmListExternalMessageTemplates: McpToolDefinition<Record<never, never>> = {
  name: "crm_list_external_message_templates",
  description:
    "Lista templates externos de canal com idioma, categoria e status do provedor; nunca finge aprová-los.",
  inputSchema: {},
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "templates",
  handler: async (_input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("meta_templates")
      .select(
        "id, channel_session_id, external_id, name, language, category, status, components, created_at, updated_at",
      )
      .eq("organization_id", ctx.organizationId)
      .order("updated_at", { ascending: false });
    if (error) falhar("not_allowed", "external_templates_read_failed");
    return {
      templates: data ?? [],
      ...humanAction({
        code: "external_template_approval_required",
        reason: "provider_approval_requires_human",
        resource: { type: "external_message_template" },
        instruction:
          "Abra Modelos de mensagem para criar, enviar e acompanhar a aprovação externa.",
        href: "/app/templates",
      }),
    };
  },
};

const productCreateShape = produtoCreateSchema.shape;
export const crmListProducts: McpToolDefinition<{
  limit: z.ZodDefault<z.ZodNumber>;
  only_active: z.ZodDefault<z.ZodBoolean>;
}> = {
  name: "crm_list_products",
  description:
    "Lista o catálogo administrativo, inclusive itens inativos, com preço e estoque reais quando controlado.",
  inputSchema: {
    limit: z.number().int().min(1).max(500).default(100),
    only_active: z.boolean().default(false),
  },
  category: "read",
  requiresRole: "viewer",
  requiresScope: "mcp:read",
  domain: "products",
  handler: async (input, ctx) => {
    let query = ctx.supabase
      .from("catalog_products")
      .select(COLUNAS_DO_PRODUTO)
      .eq("organization_id", ctx.organizationId);
    if (input.only_active) query = query.eq("ativo", true);
    const { data, error } = await query.order("nome").limit(input.limit);
    if (error) falhar("not_allowed", "products_read_failed");
    return { produtos: data ?? [] };
  },
};

export const crmGetProduct: McpToolDefinition<{ product_id: typeof uuid }> = {
  name: "crm_get_product",
  description: "Consulta um produto do catálogo da organização.",
  inputSchema: { product_id: uuid },
  category: "read",
  requiresRole: "viewer",
  requiresScope: "mcp:read",
  domain: "products",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("catalog_products")
      .select(COLUNAS_DO_PRODUTO)
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.product_id)
      .maybeSingle();
    if (error) falhar("not_allowed", "product_read_failed");
    if (!data) falhar("not_found", "Produto não encontrado.");
    return { produto: data };
  },
};

export const crmCreateProduct: McpToolDefinition<typeof productCreateShape> = {
  name: "crm_create_product",
  description: "Cria produto manual usando a moeda oficial da organização.",
  inputSchema: productCreateShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "products",
  auditResource: (_input, result) => ({
    type: "catalog_product",
    id: (result as { produto?: { id?: string } })?.produto?.id,
  }),
  handler: async (input, ctx) => {
    const moeda = await moedaDaOrganizacao(ctx.supabase, ctx.organizationId);
    const { data, error } = await ctx.supabase
      .from("catalog_products")
      .insert({ ...input, moeda, organization_id: ctx.organizationId, origem: "manual" })
      .select(COLUNAS_DO_PRODUTO)
      .single();
    if (error?.code === "23505") falhar("conflict", "Já existe produto com esse código.");
    if (error || !data) falhar("not_allowed", "Não foi possível criar o produto.");
    return { produto: data };
  },
};

const productPatchShape = { product_id: uuid, ...produtoPatchSchema.shape };
export const crmUpdateProduct: McpToolDefinition<typeof productPatchShape> = {
  name: "crm_update_product",
  description:
    "Atualiza campos reais do produto, inclusive preço, status e estoque quando existente.",
  inputSchema: productPatchShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "products",
  auditResource: (i) => ({ type: "catalog_product", id: i.product_id }),
  handler: async (input, ctx) => {
    const patch = { ...input } as Record<string, unknown>;
    delete patch.product_id;
    if (Object.keys(patch).length === 0) falhar("validation_error", "Informe ao menos um campo.");
    const { data, error } = await ctx.supabase
      .from("catalog_products")
      .update(patch)
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.product_id)
      .select(COLUNAS_DO_PRODUTO)
      .maybeSingle();
    if (error?.code === "23505") falhar("conflict", "Já existe produto com esse código.");
    if (error) falhar("not_allowed", "Não foi possível atualizar o produto.");
    if (!data) falhar("not_found", "Produto não encontrado.");
    return { produto: data };
  },
};

export const crmDeleteProduct: McpToolDefinition<{ product_id: typeof uuid }> = {
  name: "crm_delete_product",
  description: "Exclui produto do catálogo; prefira inativar quando o histórico ainda importa.",
  inputSchema: { product_id: uuid },
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "products",
  capabilities: ["destructive_operations"],
  auditResource: (i) => ({ type: "catalog_product", id: i.product_id }),
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("catalog_products")
      .delete()
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.product_id)
      .select("id")
      .maybeSingle();
    if (error) falhar("not_allowed", "Não foi possível excluir o produto.");
    if (!data) falhar("not_found", "Produto não encontrado.");
    return { id: input.product_id, deleted: true };
  },
};

export const crmListOrders: McpToolDefinition<{
  limit: z.ZodDefault<z.ZodNumber>;
  status: z.ZodOptional<z.ZodString>;
}> = {
  name: "crm_list_orders",
  description:
    "Lista pedidos sincronizados. Pedidos são histórico importado: esta API não inventa criação nem transição inexistente.",
  inputSchema: {
    limit: z.number().int().min(1).max(100).default(30),
    status: z.string().trim().min(1).max(80).optional(),
  },
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  domain: "products",
  handler: async (input, ctx) => {
    let q = ctx.supabase
      .from("orders")
      .select(ORDER_COLUMNS)
      .eq("organization_id", ctx.organizationId);
    if (input.status) q = q.eq("status", input.status);
    const { data, error } = await q
      .order("ordered_at", { ascending: false, nullsFirst: false })
      .limit(input.limit);
    if (error) falhar("not_allowed", "orders_read_failed");
    return { pedidos: data ?? [] };
  },
};

export const crmGetOrder: McpToolDefinition<{ order_id: typeof uuid }> = {
  name: "crm_get_order",
  description: "Consulta um pedido sincronizado e seus dados comerciais não secretos.",
  inputSchema: { order_id: uuid },
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  domain: "products",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("orders")
      .select(ORDER_COLUMNS)
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.order_id)
      .maybeSingle();
    if (error) falhar("not_allowed", "order_read_failed");
    if (!data) falhar("not_found", "Pedido não encontrado.");
    return { pedido: data };
  },
};

export const TEMPLATES_COMERCIO_ADMIN_MCP_TOOLS = [
  crmGetMessageTemplate,
  crmCreateMessageTemplate,
  crmUpdateMessageTemplate,
  crmDuplicateMessageTemplate,
  crmDeleteMessageTemplate,
  crmListExternalMessageTemplates,
  crmListProducts,
  crmGetProduct,
  crmCreateProduct,
  crmUpdateProduct,
  crmDeleteProduct,
  crmListOrders,
  crmGetOrder,
] as const;
