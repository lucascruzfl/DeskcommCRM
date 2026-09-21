import { z } from "zod";

import { CSV_MAX_BYTES, CSV_MAX_DATA_ROWS } from "@/lib/contacts/csv";
import { humanAction } from "@/lib/mcp/human-action";
import { McpToolError } from "@/lib/mcp/errors";
import type { McpContext, McpToolDefinition } from "@/lib/mcp/types";

const uuid = z.string().uuid();

function falhar(
  code: ConstructorParameters<typeof McpToolError>[0],
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new McpToolError(code, message, details);
}

const importacaoBase = {
  method: "POST" as const,
  content_type: "multipart/form-data",
  file_field: "file",
  accepted_extensions: ["csv"],
  accepted_mime_types: ["text/csv", "application/vnd.ms-excel"],
  max_bytes: CSV_MAX_BYTES,
  max_rows: CSV_MAX_DATA_ROWS,
  asynchronous: false,
  preview_available: false,
  status_endpoint: null,
  retry_safety:
    "Não repita uma resposta incerta automaticamente; o fluxo oficial não possui chave idempotente de importação.",
};

export const crmGetContactImportInstructions: McpToolDefinition = {
  name: "crm_get_contact_import_instructions",
  description:
    "Explica o formato oficial de importação de contatos e encaminha o arquivo para a tela, sem transportar CSV ou credenciais pelo MCP.",
  inputSchema: {},
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  domain: "contacts",
  handler: async () =>
    humanAction({
      code: "contact_csv_upload_required",
      reason: "binary_upload_requires_official_import_flow",
      resource: { type: "contact_import" },
      instruction: "Abra Contatos, escolha Importar CSV e confirme o relatório por linha na tela.",
      endpoint: "/api/v1/contacts/import",
      href: "/app/contacts",
      method: "POST",
      uploadRequired: true,
      metadata: {
        ...importacaoBase,
        required_columns: ["telefone ou email"],
        optional_columns: [
          "nome",
          "apelido",
          "documento do titular",
          "data de nascimento",
          "etiquetas",
        ],
        deduplication: "telefone, email e documento dentro da organização",
        result: "total_linhas, imported, skipped_duplicates e errors por linha",
      },
    }),
};

export const crmGetLeadImportInstructions: McpToolDefinition = {
  name: "crm_get_lead_import_instructions",
  description:
    "Explica o formato oficial para importar oportunidades em um funil e encaminha a confirmação para a tela, sem processar planilha no MCP.",
  inputSchema: {},
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  domain: "leads",
  handler: async () =>
    humanAction({
      code: "lead_csv_upload_required",
      reason: "binary_upload_requires_official_import_flow",
      resource: { type: "lead_import" },
      instruction:
        "Abra o Funil, escolha Importar planilha, selecione o funil de destino e confira os erros por linha.",
      endpoint: "/api/v1/leads/import",
      href: "/app/kanban",
      method: "POST",
      uploadRequired: true,
      metadata: {
        ...importacaoBase,
        additional_fields: ["pipeline_id", "stage_id opcional"],
        required_columns: ["nome do negócio ou nome do contato"],
        optional_columns: ["telefone", "email", "descrição", "valor", "origem", "etiquetas"],
        template_endpoint: "/api/v1/leads/import",
        template_method: "GET",
        deduplication:
          "telefone repetido no mesmo arquivo reutiliza o contato; negócios não são deduplicados",
        result: "total_linhas, criados, contatos_criados, erros e colunas_ignoradas",
      },
    }),
};

export const crmGetProductImportInstructions: McpToolDefinition = {
  name: "crm_get_product_import_instructions",
  description:
    "Explica o formato oficial para atualizar o catálogo por CSV e encaminha o arquivo para a tela, sem criar um importador paralelo.",
  inputSchema: {},
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "products",
  handler: async () =>
    humanAction({
      code: "product_csv_upload_required",
      reason: "binary_upload_requires_official_import_flow",
      resource: { type: "product_import" },
      instruction:
        "Abra Produtos, escolha Importar planilha e confira criados, atualizados e erros.",
      endpoint: "/api/v1/products/import",
      href: "/app/products",
      method: "POST",
      uploadRequired: true,
      metadata: {
        ...importacaoBase,
        required_columns: ["nome", "preço"],
        optional_columns: ["código", "custo", "marca", "categoria", "estoque"],
        deduplication: "upsert por código dentro da organização; sem código, o nome é a identidade",
        result: "total_linhas, criados, atualizados, erros e colunas_ignoradas",
      },
    }),
};

const mediaUploadShape = { conversation_id: uuid };
export const crmGetConversationMediaUploadInstructions: McpToolDefinition<typeof mediaUploadShape> =
  {
    name: "crm_get_conversation_media_upload_instructions",
    description:
      "Valida a conversa no tenant e explica como subir mídia no bucket privado oficial; depois o caminho resultante pode ser usado pelas tools de mensagem.",
    inputSchema: mediaUploadShape,
    category: "read",
    requiresRole: "agent",
    requiresScope: "mcp:read",
    domain: "messages",
    handler: async (input, ctx) => {
      const { data, error } = await ctx.supabase
        .from("conversations")
        .select("id")
        .eq("organization_id", ctx.organizationId)
        .eq("id", input.conversation_id)
        .maybeSingle();
      if (error) falhar("not_allowed", "conversation_media_upload_check_failed");
      if (!data) falhar("not_found", "Conversa não encontrada.");
      return humanAction({
        code: "conversation_media_upload_required",
        reason: "binary_upload_requires_official_endpoint",
        resource: { type: "conversation", id: input.conversation_id },
        instruction:
          "Abra a conversa e envie o arquivo pelo seletor de mídia; use o storage_path retornado para enviar a mensagem pelo MCP.",
        endpoint: `/api/v1/conversations/${input.conversation_id}/media`,
        href: `/app/inbox?conversation=${input.conversation_id}`,
        method: "POST",
        uploadRequired: true,
        metadata: {
          content_type: "multipart/form-data",
          fields: ["file"],
          accepted_types: ["image/*", "video/*", "audio/*", "PDF, Office, texto, CSV e ZIP"],
          max_bytes: 50 * 1024 * 1024,
          result: "storage_path, media_mime, media_size_bytes e kind",
        },
      });
    },
  };

export const crmGetTemplateMediaUploadInstructions: McpToolDefinition = {
  name: "crm_get_template_media_upload_instructions",
  description:
    "Explica como subir a imagem privada de um modelo externo no fluxo oficial, sem transportar o arquivo nem devolver credenciais.",
  inputSchema: {},
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "templates",
  handler: async () =>
    humanAction({
      code: "template_media_upload_required",
      reason: "binary_upload_requires_official_endpoint",
      resource: { type: "external_message_template_media" },
      instruction: "Abra Modelos de mensagem e envie uma imagem JPG ou PNG pelo formulário.",
      endpoint: "/api/v1/channels/partner/templates/media",
      href: "/app/templates",
      method: "POST",
      uploadRequired: true,
      metadata: {
        content_type: "multipart/form-data",
        fields: ["file"],
        accepted_mime_types: ["image/jpeg", "image/png"],
        max_bytes: 5 * 1024 * 1024,
        result: "path privado e URL temporária usada pelo fluxo oficial de aprovação",
      },
    }),
};

export const crmGetAiSkillImportInstructions: McpToolDefinition = {
  name: "crm_get_ai_skill_import_instructions",
  description:
    "Explica como importar um pacote de habilidade assinado pelo fluxo oficial, mantendo o arquivo e a confirmação fora do transporte MCP.",
  inputSchema: {},
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "ai",
  handler: async () =>
    humanAction({
      code: "ai_skill_package_upload_required",
      reason: "package_upload_requires_human_review",
      resource: { type: "ai_skill_package" },
      instruction: "Abra Habilidades da IA, revise a origem do pacote e envie o arquivo ZIP.",
      endpoint: "/api/v1/ai/skills/import",
      href: "/app/ai/skills",
      method: "POST",
      uploadRequired: true,
      metadata: {
        content_type: "multipart/form-data",
        fields: ["file"],
        accepted_extensions: ["zip"],
        max_bytes: 5 * 1024 * 1024,
        result: "name e version_id",
      },
    }),
};

const bulkShape = {
  action: z.enum(["move", "assign", "tag", "delete"]),
  lead_ids: z.array(uuid).min(1).max(50),
  stage_id: uuid.optional(),
  lost_reason: z.string().trim().max(500).optional(),
  owner_user_id: uuid.nullable().optional(),
  add_tags: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  remove_tags: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
};

async function previewBulk(input: z.infer<z.ZodObject<typeof bulkShape>>, ctx: McpContext) {
  const ids = [...new Set(input.lead_ids)];
  const { data, error } = await ctx.supabase
    .from("crm_leads")
    .select("id, title, status, stage_id, pipeline_id, owner_user_id, tags")
    .eq("organization_id", ctx.organizationId)
    .in("id", ids);
  if (error) falhar("not_allowed", "lead_bulk_preview_failed");
  const leads = data ?? [];
  const encontrados = new Set(leads.map((lead) => lead.id));
  const missing = ids.filter((id) => !encontrados.has(id));
  const details: Record<string, unknown> = {};

  if (input.action === "move") {
    if (!input.stage_id) falhar("validation_error", "stage_id é obrigatório para mover em lote.");
    const { data: stage } = await ctx.supabase
      .from("crm_stages")
      .select("id, name, pipeline_id, is_won, is_lost, is_archived")
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.stage_id)
      .maybeSingle();
    if (!stage || stage.is_archived) falhar("not_found", "Etapa de destino ativa não encontrada.");
    details.destination = stage;
    details.requires_lost_reason = Boolean(stage.is_lost);
    details.closes_demands = Boolean(stage.is_won || stage.is_lost);
  }
  if (input.action === "assign" && input.owner_user_id) {
    const { data: member } = await ctx.supabase
      .from("user_organizations")
      .select("user_id, role")
      .eq("organization_id", ctx.organizationId)
      .eq("user_id", input.owner_user_id)
      .is("revoked_at", null)
      .not("accepted_at", "is", null)
      .maybeSingle();
    if (!member || member.role === "viewer")
      falhar("validation_error", "Responsável não é atendente ativo desta organização.");
    details.owner = member;
  }
  if (input.action === "tag" && input.add_tags.length === 0 && input.remove_tags.length === 0) {
    falhar("validation_error", "Informe ao menos uma etiqueta para adicionar ou remover.");
  }

  return {
    preview: true,
    side_effects_executed: false,
    operation: input.action,
    requested_count: ids.length,
    affected_count: leads.length,
    missing_lead_ids: missing,
    resources: leads,
    destructive: input.action === "delete",
    risks:
      input.action === "delete"
        ? [
            "Exclusão definitiva de negócios; exige confirmação humana e capability destrutiva na execução.",
          ]
        : input.action === "move"
          ? ["Mover para etapa de ganho ou perda pode encerrar demandas."]
          : [],
    ...details,
  };
}

export const crmPreviewLeadBulkAction: McpToolDefinition<typeof bulkShape> = {
  name: "crm_preview_lead_bulk_action",
  description:
    "Mostra quais oportunidades seriam afetadas por uma ação em lote, valida etapa ou responsável no tenant e não modifica nenhum dado.",
  inputSchema: bulkShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "leads",
  handler: previewBulk,
};

export const crmPrepareLeadBulkAction: McpToolDefinition<typeof bulkShape> = {
  name: "crm_prepare_lead_bulk_action",
  description:
    "Valida e resume uma ação em lote de até 50 oportunidades, mas deixa a confirmação e a execução no fluxo oficial da tela.",
  inputSchema: bulkShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "leads",
  handler: async (input, ctx) => {
    const preview = await previewBulk(input, ctx);
    return {
      ...humanAction({
        code: "lead_bulk_confirmation_required",
        reason:
          input.action === "delete"
            ? "destructive_bulk_requires_human_confirmation"
            : "bulk_execution_uses_official_session_flow",
        resource: { type: "crm_lead_bulk" },
        instruction: "Revise a prévia e conclua a ação em lote no Funil.",
        endpoint: "/api/v1/leads/bulk",
        href: "/app/kanban",
        method: "POST",
        metadata: {
          required_capability: input.action === "delete" ? "destructive_operations" : null,
          max_items: 50,
        },
      }),
      ...preview,
    };
  },
};

const auditExportShape = {
  actor_id: uuid.optional(),
  action: z.string().trim().min(1).max(100).optional(),
  resource_type: z.string().trim().min(1).max(100).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
};
export const crmPrepareAuditExport: McpToolDefinition<typeof auditExportShape> = {
  name: "crm_prepare_audit_export",
  description:
    "Prepara filtros para a exportação oficial de auditoria e exige download humano, evitando devolver até dez mil linhas com dados pessoais pelo MCP.",
  inputSchema: auditExportShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "audit",
  handler: async (input) => {
    const query = new URLSearchParams(
      Object.entries(input).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ).toString();
    const endpoint = `/api/v1/audit/export${query ? `?${query}` : ""}`;
    return humanAction({
      code: "audit_export_download_required",
      reason: "export_contains_pii_and_must_use_official_download",
      resource: { type: "api_audit_export" },
      instruction: "Abra Auditoria, revise os filtros e baixe o CSV pela sessão autenticada.",
      endpoint,
      href: "/app/audit",
      method: "GET",
      metadata: {
        filters: input,
        format: "text/csv",
        max_rows: 10_000,
        contains_personal_data: true,
        binary_returned_by_mcp: false,
      },
    });
  },
};

const privacyStatusShape = { request_id: uuid };
export const crmGetPrivacyExportStatus: McpToolDefinition<typeof privacyStatusShape> = {
  name: "crm_get_privacy_export_status",
  description:
    "Consulta o progresso e o resultado seguro de uma exportação LGPD no tenant; não devolve arquivo, caminho privado, e-mail ou URL assinada.",
  inputSchema: privacyStatusShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "privacy",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("lgpd_requests")
      .select(
        "id, request_type, status, attempts, received_at, due_at, completed_at, emergency, scope, result, created_at, updated_at",
      )
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.request_id)
      .maybeSingle();
    if (error) falhar("not_allowed", "privacy_export_status_failed");
    if (!data || data.request_type !== "data_request")
      falhar("not_found", "Exportação LGPD não encontrada.");
    const result = (data.result as Record<string, unknown> | null) ?? {};
    const safeResult = {
      sha256: typeof result.sha256 === "string" ? result.sha256 : null,
      signed_pades: result.signed_pades === true,
      warning: typeof result.warning === "string" ? result.warning : null,
      delivered: typeof result.delivered_to_hash === "string",
    };
    const { result: _privateResult, ...request } = data;
    return {
      request,
      result: safeResult,
      ...(data.status === "completed" || data.status === "pending_review"
        ? humanAction({
            code: "privacy_export_human_delivery_required",
            reason: "privacy_export_download_requires_admin_session",
            resource: { type: "lgpd_request", id: data.id },
            instruction: "Abra o pedido LGPD para revisar a entrega e gerar um link temporário.",
            endpoint: `/api/v1/lgpd/requests/${data.id}`,
            href: `/app/lgpd/requests/${data.id}`,
            method: "GET",
          })
        : {}),
    };
  },
};

export const crmPrepareMcpTokenManagement: McpToolDefinition = {
  name: "crm_prepare_mcp_token_management",
  description:
    "Explica como uma pessoa administradora cria, limita, identifica ou revoga tokens; o token atual nunca cria nem amplia a própria autoridade.",
  inputSchema: {},
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "settings",
  handler: async (_input, ctx) =>
    humanAction({
      code: "mcp_token_admin_session_required",
      reason: "self_escalation_is_forbidden",
      resource: { type: "api_token", id: ctx.apiTokenId },
      instruction:
        "Peça a uma pessoa administradora para abrir Tokens de API. O token em uso não pode criar, ampliar ou revogar a si próprio.",
      endpoint: "/api/v1/settings/api-tokens",
      href: "/app/settings/api-tokens",
      method: "GET",
      metadata: {
        required_role: "admin",
        supports: [
          "nome",
          "preset",
          "scopes",
          "allowlist de tools",
          "capabilities",
          "expiração",
          "revogação",
        ],
        list_returns_plaintext: false,
        create_returns_plaintext_once: true,
        current_token_can_self_escalate: false,
      },
    }),
};

export const crmGetOperationalDiagnostics: McpToolDefinition = {
  name: "crm_get_operational_diagnostics",
  description:
    "Resume falhas operacionais de canais, conhecimento, automações, follow-up e workers sem revelar segredos, rede privada ou detalhes da VPS.",
  inputSchema: {},
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "operations",
  handler: async (_input, ctx) => {
    const [channels, knowledge, automationFailures, followupFailures, pendingEvents, deadEvents] =
      await Promise.all([
        ctx.supabase
          .from("channel_sessions")
          .select(
            "id, display_name, provider, status, status_reason, last_health_check_at, last_status_change_at",
          )
          .eq("organization_id", ctx.organizationId)
          .is("archived_at", null)
          .order("updated_at", { ascending: false })
          .limit(100),
        ctx.supabase
          .from("ai_knowledge_sources")
          .select(
            "id, name, status, last_index_status, last_indexed_at, chunks_count, last_index_error",
          )
          .eq("organization_id", ctx.organizationId)
          .neq("status", "archived")
          .limit(100),
        ctx.supabase
          .from("automation_rule_runs")
          .select("id, rule_id, status, created_at")
          .eq("organization_id", ctx.organizationId)
          .eq("status", "failed")
          .order("created_at", { ascending: false })
          .limit(20),
        ctx.supabase
          .from("followup_enrollments")
          .select("id, pointer_id, status, next_eval_at, updated_at")
          .eq("organization_id", ctx.organizationId)
          .eq("status", "failed")
          .order("updated_at", { ascending: false })
          .limit(20),
        ctx.supabase
          .from("event_log")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", ctx.organizationId)
          .eq("status", "pending"),
        ctx.supabase
          .from("event_log")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", ctx.organizationId)
          .eq("status", "dead"),
      ]);

    const failed = [
      channels,
      knowledge,
      automationFailures,
      followupFailures,
      pendingEvents,
      deadEvents,
    ].find((result) => result.error)?.error;
    if (failed) falhar("not_allowed", "operational_diagnostics_failed");
    return {
      channels: channels.data ?? [],
      knowledge: (knowledge.data ?? []).map(({ last_index_error, ...source }) => ({
        ...source,
        has_index_error: Boolean(last_index_error),
      })),
      automation_failures: automationFailures.data ?? [],
      followup_failures: followupFailures.data ?? [],
      workers: {
        pending_events: pendingEvents.count ?? 0,
        dead_events: deadEvents.count ?? 0,
      },
      infrastructure_details_included: false,
      secrets_included: false,
      limits: { channels: 100, knowledge: 100, failures_per_domain: 20 },
    };
  },
};

export const PARTE7_OPERATION_TOOLS = [
  crmGetContactImportInstructions,
  crmGetLeadImportInstructions,
  crmGetProductImportInstructions,
  crmGetConversationMediaUploadInstructions,
  crmGetTemplateMediaUploadInstructions,
  crmGetAiSkillImportInstructions,
  crmPreviewLeadBulkAction,
  crmPrepareLeadBulkAction,
  crmPrepareAuditExport,
  crmGetPrivacyExportStatus,
  crmPrepareMcpTokenManagement,
  crmGetOperationalDiagnostics,
] as const;
