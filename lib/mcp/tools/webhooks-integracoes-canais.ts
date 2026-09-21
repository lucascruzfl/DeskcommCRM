import { z } from "zod";

import {
  lerModoDeAcessoDaIa,
  lerNumerosDeTeste,
  aiAccessUpdateSchema,
} from "@/lib/ai/elegibilidade/pre-go-live";
import { McpToolError } from "@/lib/mcp/errors";
import type { McpContext, McpToolDefinition } from "@/lib/mcp/types";

const uuid = z.string().uuid();
const WEBHOOK_COLUMNS =
  "id, name, is_active, kind, path_token, default_pipeline_id, default_stage_id, redirect_to, field_map, last_received_at, secret_encrypted, created_at, updated_at";
const CHANNEL_COLUMNS =
  "id, provider, display_name, phone_number, status, status_reason, last_health_check_at, last_status_change_at, daily_message_limit, is_warmup_complete, created_at, metadata";

function falhar(code: ConstructorParameters<typeof McpToolError>[0], message: string): never {
  throw new McpToolError(code, message);
}
async function exigirProvisionadorAdmin(ctx: McpContext) {
  if (!ctx.provisionedByUserId)
    falhar("human_action_required", "Ação exige token provisionado por administrador humano.");
  const { data } = await ctx.supabase
    .from("user_organizations")
    .select("id")
    .eq("organization_id", ctx.organizationId)
    .eq("user_id", ctx.provisionedByUserId!)
    .eq("role", "admin")
    .is("revoked_at", null)
    .not("accepted_at", "is", null)
    .maybeSingle();
  if (!data)
    falhar(
      "human_action_required",
      "A configuração do canal exige um token provisionado por administrador ativo.",
    );
}
function webhookSeguro(row: Record<string, unknown>) {
  const { secret_encrypted, ...safe } = row;
  return { ...safe, has_secret: secret_encrypted != null };
}

async function webhookDaOrg(ctx: McpContext, id: string) {
  const { data, error } = await ctx.supabase
    .from("webhook_sources")
    .select(WEBHOOK_COLUMNS)
    .eq("organization_id", ctx.organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error) falhar("not_allowed", "webhook_source_read_failed");
  if (!data) falhar("not_found", "Entrada automática não encontrada.");
  return data as Record<string, unknown>;
}

export const crmGetWebhookSource: McpToolDefinition<{ webhook_id: typeof uuid }> = {
  name: "crm_get_webhook_source",
  description:
    "Consulta a configuração segura de uma entrada automática. O segredo nunca é retornado.",
  inputSchema: { webhook_id: uuid },
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "webhooks",
  handler: async (i, c) => ({ entrada: webhookSeguro(await webhookDaOrg(c, i.webhook_id)) }),
};

const webhookPatchShape = {
  webhook_id: uuid,
  name: z.string().trim().min(1).max(120).optional(),
  default_pipeline_id: uuid.optional(),
  default_stage_id: uuid.optional(),
  redirect_to: z.string().url().max(2000).nullable().optional(),
  field_map: z.record(z.string(), z.array(z.string())).optional(),
};
export const crmUpdateWebhookSource: McpToolDefinition<typeof webhookPatchShape> = {
  name: "crm_update_webhook_source",
  description:
    "Atualiza nome, destino e mapa de campos de uma entrada automática sem disparar chamada externa e sem revelar segredo.",
  inputSchema: webhookPatchShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "webhooks",
  auditResource: (i) => ({ type: "webhook_source", id: i.webhook_id }),
  handler: async (input, ctx) => {
    const current = await webhookDaOrg(ctx, input.webhook_id);
    const pipeline = input.default_pipeline_id ?? String(current.default_pipeline_id);
    const stage = input.default_stage_id ?? String(current.default_stage_id);
    const { data: validStage } = await ctx.supabase
      .from("crm_stages")
      .select("id")
      .eq("organization_id", ctx.organizationId)
      .eq("pipeline_id", pipeline)
      .eq("id", stage)
      .eq("is_archived", false)
      .maybeSingle();
    if (!validStage)
      falhar(
        "validation_error",
        "Pipeline e etapa precisam pertencer à organização e estar ativos.",
      );
    const patch = { ...input, default_pipeline_id: pipeline, default_stage_id: stage } as Record<
      string,
      unknown
    >;
    delete patch.webhook_id;
    const { data, error } = await ctx.supabase
      .from("webhook_sources")
      .update(patch)
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.webhook_id)
      .select(WEBHOOK_COLUMNS)
      .single();
    if (error || !data) falhar("not_allowed", "Não foi possível atualizar a entrada automática.");
    return { entrada: webhookSeguro(data as Record<string, unknown>) };
  },
};

export const crmDeleteWebhookSource: McpToolDefinition<{ webhook_id: typeof uuid }> = {
  name: "crm_delete_webhook_source",
  description: "Exclui uma entrada automática; a URL publicada deixa de captar contatos.",
  inputSchema: { webhook_id: uuid },
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "webhooks",
  capabilities: ["destructive_operations"],
  auditResource: (i) => ({ type: "webhook_source", id: i.webhook_id }),
  handler: async (i, c) => {
    const { data, error } = await c.supabase
      .from("webhook_sources")
      .delete()
      .eq("organization_id", c.organizationId)
      .eq("id", i.webhook_id)
      .select("id")
      .maybeSingle();
    if (error) falhar("not_allowed", "Não foi possível excluir a entrada automática.");
    if (!data) falhar("not_found", "Entrada automática não encontrada.");
    return { id: i.webhook_id, deleted: true };
  },
};

export const crmDiscoverIntegrations: McpToolDefinition<Record<never, never>> = {
  name: "crm_discover_integrations",
  description:
    "Descobre integrações suportadas, requisitos e estado seguro, para não adivinhar providers nem credenciais.",
  inputSchema: {},
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "channels",
  handler: async (_i, ctx) => {
    const { data, error } = await ctx.supabase
      .from("tenant_integrations")
      .select(
        "id, provider, status, status_reason, scopes, store_metadata, webhook_subscriptions, last_sync_at, created_at, updated_at",
      )
      .eq("organization_id", ctx.organizationId)
      .order("created_at");
    if (error) falhar("not_allowed", "integrations_read_failed");
    return {
      supported: [
        {
          provider: "nuvemshop",
          capabilities: ["oauth", "catalog_sync", "order_sync"],
          connection: "human_oauth",
        },
      ],
      connections: data ?? [],
    };
  },
};

const integrationActionShape = {
  provider: z.literal("nuvemshop"),
  action: z.enum(["connect", "disconnect"]),
};
export const crmPrepareIntegrationAction: McpToolDefinition<typeof integrationActionShape> = {
  name: "crm_prepare_integration_action",
  description:
    "Prepara conexão ou desconexão de integração que exige navegador e confirmação humana; não automatiza consentimento OAuth.",
  inputSchema: integrationActionShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "channels",
  handler: async (input) => ({
    human_action_required: true,
    provider: input.provider,
    reason:
      input.action === "connect"
        ? "oauth_consent_requires_human"
        : "disconnect_requires_human_confirmation",
    instruction: `Abra Integrações e escolha ${input.action === "connect" ? "Conectar" : "Desconectar"}.`,
    url: "/app/integrations/nuvemshop",
  }),
};

async function canalDaOrg(ctx: McpContext, id: string) {
  const { data, error } = await ctx.supabase
    .from("channel_sessions")
    .select(CHANNEL_COLUMNS)
    .eq("organization_id", ctx.organizationId)
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (error) falhar("not_allowed", "channel_read_failed");
  if (!data) falhar("not_found", "Canal não encontrado.");
  return data as Record<string, unknown>;
}

export const crmGetChannelAdmin: McpToolDefinition<{ channel_id: typeof uuid }> = {
  name: "crm_get_channel_admin",
  description:
    "Consulta status, health e configuração administrativa não sensível de um canal; não devolve segredo de sessão.",
  inputSchema: { channel_id: uuid },
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "channels",
  handler: async (i, c) => {
    const channel = await canalDaOrg(c, i.channel_id);
    const { metadata, ...safe } = channel;
    return {
      canal: {
        ...safe,
        ai_access: {
          mode: lerModoDeAcessoDaIa(metadata),
          test_phone_numbers: lerNumerosDeTeste(metadata),
        },
      },
    };
  },
};

const channelAiShape = {
  channel_id: uuid,
  mode: z.enum(["open", "pre_go_live"]),
  test_phone_numbers: z.array(z.string()).max(100),
};
export const crmUpdateChannelAiAccess: McpToolDefinition<typeof channelAiShape> = {
  name: "crm_update_channel_ai_access",
  description:
    "Atualiza atomicamente o alcance operacional da IA no canal sem alterar credenciais ou sessão.",
  inputSchema: channelAiShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "channels",
  auditResource: (i) => ({ type: "channel_session", id: i.channel_id }),
  handler: async (i, c) => {
    await exigirProvisionadorAdmin(c);
    await canalDaOrg(c, i.channel_id);
    const parsed = aiAccessUpdateSchema.safeParse(i);
    if (!parsed.success) falhar("validation_error", "Use telefones com DDI.");
    const { data, error } = await c.supabase.rpc(
      "fn_configurar_pre_go_live_canal" as never,
      {
        p_org: c.organizationId,
        p_canal: i.channel_id,
        p_modo: parsed.data.mode,
        p_numeros: parsed.data.test_phone_numbers,
      } as never,
    );
    if (error) falhar("not_allowed", "Não foi possível atualizar o acesso da IA.");
    if (Number(data) !== 1) falhar("not_found", "Canal não encontrado.");
    return { channel_id: i.channel_id, ...parsed.data };
  },
};

const channelActionShape = {
  channel_id: uuid.optional(),
  action: z.enum(["provision", "pair", "reconnect", "archive"]),
};
export const crmPrepareChannelAction: McpToolDefinition<typeof channelActionShape> = {
  name: "crm_prepare_channel_action",
  description:
    "Orienta provisionamento, QR/pairing, reconexão ou arquivamento que dependem de pessoa/provedor. Nunca retorna segredo da sessão.",
  inputSchema: channelActionShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "channels",
  handler: async (i, c) => {
    if (i.action !== "provision" && !i.channel_id)
      falhar("validation_error", "channel_id é obrigatório para esta ação.");
    if (i.channel_id) await canalDaOrg(c, i.channel_id);
    return {
      human_action_required: true,
      reason:
        i.action === "pair"
          ? "qr_or_pairing_requires_human"
          : "channel_external_effect_requires_human",
      instruction: "Abra Conexões para concluir a ação e confirmar o estado do provedor.",
      url: "/app/connections",
      channel_id: i.channel_id ?? null,
      action: i.action,
    };
  },
};

export const WEBHOOKS_INTEGRACOES_CANAIS_MCP_TOOLS = [
  crmGetWebhookSource,
  crmUpdateWebhookSource,
  crmDeleteWebhookSource,
  crmDiscoverIntegrations,
  crmPrepareIntegrationAction,
  crmGetChannelAdmin,
  crmUpdateChannelAiAccess,
  crmPrepareChannelAction,
] as const;
