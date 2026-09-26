import { z } from "zod";

import {
  getConversationHandler,
  markConversationReadHandler,
} from "@/app/api/v1/conversations/_handler";
import { audit } from "@/lib/audit";
import {
  criarNotaDaConversa,
  listarNotasDaConversa,
  removerNotaDaConversa,
} from "@/lib/atendimento/notas-da-conversa";
import { listSelectableChannels } from "@/lib/channels/selectable";
import { lerEstadoDoCanal } from "@/lib/channels/estado";
import { McpToolError } from "../errors";
import type { McpContext, McpToolDefinition } from "../types";
import { resolveUserNames } from "./_users";

const messageColumns =
  "id, conversation_id, contact_id, channel_session_id, external_id, type, direction, status, ack, error_code, error_message, body, media_mime, media_size_bytes, sent_via, sent_by_user_id, sent_at, delivered_at, read_at, edited_at, revoked_at, reply_to_message_id, created_at";

const getMessageInput = { message_id: z.string().uuid() };
export const crmGetMessage: McpToolDefinition<typeof getMessageInput> = {
  name: "crm_get_message",
  description:
    "Consulta uma mensagem do tenant com direção, tipo, status de entrega/erro e vínculo de resposta. Não devolve URL privada, signed URL, storage path nem credencial do canal; media_available informa apenas se há mídia associada.",
  inputSchema: getMessageInput,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  domain: "messages",
  capabilities: [],
  publicProfile: true,
  auditResource: (input) => ({ type: "message", id: input.message_id }),
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("operational_messages")
      .select(`${messageColumns}, media_storage_path, media_url`)
      .eq("id", input.message_id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new McpToolError("not_found", "message_not_found");
    const row = data as Record<string, unknown>;
    const { media_storage_path, media_url, ...safe } = row;
    return { ...safe, media_available: Boolean(media_storage_path || media_url) };
  },
};

const stateInput = {
  conversation_id: z.string().uuid(),
  expected_revision: z.number().int().positive().optional(),
};

async function mudarEstado(
  input: z.infer<z.ZodObject<typeof stateInput>>,
  ctx: McpContext,
  status: "closed" | "open",
) {
  const observed = await getConversationHandler(
    ctx.supabase,
    { organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId },
    input.conversation_id,
  );
  const { data, error } = await ctx.supabase.rpc("fn_service_status", {
    p_org: ctx.organizationId,
    p_conversation: input.conversation_id,
    p_status: status,
    p_expected: input.expected_revision ?? observed.service_revision,
  });
  if (error?.code === "40001") throw new McpToolError("conflict", "conversation_revision_conflict");
  if (error?.code === "P0002") throw new McpToolError("not_found", "conversation_not_found");
  if (error) throw new Error(error.message);
  await audit({
    action: status === "closed" ? "conversation.closed" : "conversation.released",
    actorUserId: ctx.actor.type === "user" ? ctx.actor.id : null,
    actorApiTokenId: ctx.apiTokenId,
    organizationId: ctx.organizationId,
    resourceType: "conversation",
    resourceId: input.conversation_id,
    requestId: ctx.requestId,
    metadata: { actor_type: ctx.actor.type, via: "mcp", status },
  });
  return { conversation_id: input.conversation_id, status, conversation: data };
}

export const crmCloseConversation: McpToolDefinition<typeof stateInput> = {
  name: "crm_close_conversation",
  description:
    "Fecha o atendimento pelo comando oficial `fn_service_status`, preservando revisão, fronteira do episódio, histórico e automações ligadas ao encerramento. Use expected_revision quando leu a conversa antes; conflito exige reler, nunca sobrescrever.",
  inputSchema: stateInput,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  domain: "conversations",
  capabilities: [],
  publicProfile: true,
  auditResource: (input) => ({ type: "conversation", id: input.conversation_id }),
  handler: (input, ctx) => mudarEstado(input, ctx, "closed"),
};

export const crmReopenConversation: McpToolDefinition<typeof stateInput> = {
  name: "crm_reopen_conversation",
  description:
    "Reabre um atendimento encerrado pelo mesmo comando oficial de estado, criando uma nova revisão de serviço em vez de alterar status diretamente. Não retoma a IA automaticamente; para isso uma pessoa usa crm_resume_ai_attendance.",
  inputSchema: stateInput,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  domain: "conversations",
  capabilities: [],
  publicProfile: true,
  auditResource: (input) => ({ type: "conversation", id: input.conversation_id }),
  handler: (input, ctx) => mudarEstado(input, ctx, "open"),
};

const markReadInput = { conversation_id: z.string().uuid() };
export const crmMarkConversationRead: McpToolDefinition<typeof markReadInput> = {
  name: "crm_mark_conversation_read",
  description:
    "Marca como lidas as mensagens recebidas da conversa para o responsável atual pelo handler oficial do Inbox. Não altera delivery/read receipt no celular do cliente.",
  inputSchema: markReadInput,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  domain: "conversations",
  capabilities: [],
  publicProfile: true,
  auditResource: (input) => ({ type: "conversation", id: input.conversation_id }),
  handler: async (input, ctx) => {
    const conversation = await markConversationReadHandler(
      ctx.supabase,
      { organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId },
      input.conversation_id,
    );
    return { conversation_id: input.conversation_id, unread_count: 0, conversation };
  },
};

const notesListInput = { conversation_id: z.string().uuid() };
export const crmListInternalNotes: McpToolDefinition<typeof notesListInput> = {
  name: "crm_list_internal_notes",
  description:
    "Lista notas INTERNAS de uma conversa em ordem cronológica. Essas notas são visíveis somente para a equipe e para a continuidade autorizada; nunca são enviadas ao cliente ou ao canal.",
  inputSchema: notesListInput,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  domain: "conversations",
  capabilities: [],
  publicProfile: true,
  auditResource: (input) => ({ type: "conversation", id: input.conversation_id }),
  handler: async (input, ctx) => ({
    notes: await listarNotasDaConversa(ctx.supabase, ctx.organizationId, input.conversation_id),
  }),
};

const noteCreateInput = {
  conversation_id: z.string().uuid(),
  body: z.string().trim().min(1).max(4000),
};
export const crmCreateInternalNote: McpToolDefinition<typeof noteCreateInput> = {
  name: "crm_create_internal_note",
  description:
    "Cria uma nota INTERNA no atendimento. Ela não envia mensagem, não chama WhatsApp e não fica visível ao cliente. Preserva o autor humano que provisionou o token, emite menções oficiais e registra auditoria sem copiar o texto da nota.",
  inputSchema: noteCreateInput,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  domain: "conversations",
  capabilities: [],
  publicProfile: true,
  auditResource: (input, result) => ({
    type: "conversation_note",
    id: (result as { id?: string } | undefined)?.id ?? input.conversation_id,
  }),
  handler: async (input, ctx) => {
    if (!ctx.provisionedByUserId) {
      throw new McpToolError("not_allowed", "internal_note_requires_human_token_owner");
    }
    const names = await resolveUserNames(ctx.supabase, [ctx.provisionedByUserId]);
    return criarNotaDaConversa({
      db: ctx.supabase,
      organizationId: ctx.organizationId,
      conversationId: input.conversation_id,
      body: input.body,
      authorUserId: ctx.provisionedByUserId,
      authorName: names.get(ctx.provisionedByUserId) ?? null,
      apiTokenId: ctx.apiTokenId,
      requestId: ctx.requestId,
    });
  },
};

const noteDeleteInput = {
  conversation_id: z.string().uuid(),
  note_id: z.string().uuid(),
};
export const crmDeleteInternalNote: McpToolDefinition<typeof noteDeleteInput> = {
  name: "crm_delete_internal_note",
  description:
    "Remove uma nota INTERNA da conversa, sem enviar nada ao cliente. Só o autor humano que provisionou o token ou manager+ pode apagar; exige destructive_operations e valida nota, conversa e tenant juntos antes da exclusão.",
  inputSchema: noteDeleteInput,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  domain: "conversations",
  capabilities: ["destructive_operations"],
  publicProfile: true,
  auditResource: (input) => ({ type: "conversation_note", id: input.note_id }),
  handler: async (input, ctx) => {
    if (!ctx.provisionedByUserId) {
      throw new McpToolError("not_allowed", "internal_note_requires_human_token_owner");
    }
    try {
      return await removerNotaDaConversa({
        db: ctx.supabase,
        organizationId: ctx.organizationId,
        conversationId: input.conversation_id,
        noteId: input.note_id,
        actorUserId: ctx.provisionedByUserId,
        actorRole: ctx.role,
        apiTokenId: ctx.apiTokenId,
        requestId: ctx.requestId,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "conversation_note_not_found") {
        throw new McpToolError("not_found", error.message);
      }
      if (error instanceof Error && error.message === "conversation_note_delete_forbidden") {
        throw new McpToolError("not_allowed", error.message);
      }
      throw error;
    }
  },
};

const channelsInput = { only_sendable: z.boolean().default(false) };
export const crmListMessagingChannels: McpToolDefinition<typeof channelsInput> = {
  name: "crm_list_messaging_channels",
  description:
    "Descobre os canais de mensagem ativos do tenant e informa status, telefone mascarável de operação, se aceitam texto livre e se podem enviar agora. Não devolve nome interno de sessão, token, secret, webhook secret nem credenciais. Estados que exigem QR/consentimento retornam human_action_required=true.",
  inputSchema: channelsInput,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  domain: "channels",
  capabilities: [],
  publicProfile: true,
  auditResource: () => ({ type: "channel_session" }),
  handler: async (input, ctx) => {
    const channels = await listSelectableChannels(ctx.supabase, ctx.organizationId);
    const safe = channels.map((channel) => {
      const state = lerEstadoDoCanal(channel.status);
      return {
        channel_id: channel.id,
        display_name: channel.display_name,
        phone_number: channel.phone_number,
        status: channel.status,
        status_label: state.rotulo,
        can_send_now: state.utilizavel,
        accepts_freeform: channel.aceitaMensagemLivre,
        human_action_required: channel.status === "SCAN_QR_CODE",
      };
    });
    return {
      channels: input.only_sendable ? safe.filter((channel) => channel.can_send_now) : safe,
      available_count: safe.filter((channel) => channel.can_send_now).length,
    };
  },
};

const handoffHistoryInput = {
  conversation_id: z.string().uuid(),
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
};
type HandoffCursor = { criado_em: string; id: string };
function decodeHandoffCursor(raw: string): HandoffCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as HandoffCursor;
    if (typeof parsed.criado_em !== "string" || typeof parsed.id !== "string") throw new Error();
    return parsed;
  } catch {
    throw new McpToolError("validation_error", "invalid_cursor");
  }
}

export const crmListHandoffHistory: McpToolDefinition<typeof handoffHistoryInput> = {
  name: "crm_list_handoff_history",
  description:
    "Lista, com paginação, as passagens IA↔humano registradas numa conversa: origem, motivo, tentativas, aviso ao cliente, caso relacionado e reconhecimento. É o histórico oficial de continuidade do atendimento, não uma inferência sobre flags atuais.",
  inputSchema: handoffHistoryInput,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  domain: "conversations",
  capabilities: [],
  publicProfile: true,
  auditResource: (input) => ({ type: "conversation", id: input.conversation_id }),
  handler: async (input, ctx) => {
    const { data: conversation, error: conversationError } = await ctx.supabase
      .from("operational_conversations")
      .select("id")
      .eq("id", input.conversation_id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    if (conversationError) throw new Error(conversationError.message);
    if (!conversation) throw new McpToolError("not_found", "conversation_not_found");

    let query = ctx.supabase
      .from("passagens_de_atendimento")
      .select(
        "id, origem, motivo_codigo, title, body, notes, content, tentativas, cliente_avisado, aviso_motivo_codigo, caso_id, criado_em, reconhecido_em, reconhecido_por",
      )
      .eq("conversation_id", input.conversation_id)
      .eq("organization_id", ctx.organizationId)
      .order("criado_em", { ascending: false })
      .order("id", { ascending: false })
      .limit(input.limit + 1);
    if (input.cursor) {
      const cursor = decodeHandoffCursor(input.cursor);
      query = query.or(
        `criado_em.lt.${cursor.criado_em},and(criado_em.eq.${cursor.criado_em},id.lt.${cursor.id})`,
      );
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<
      Record<string, unknown> & { id: string; criado_em: string; reconhecido_por: string | null }
    >;
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const names = await resolveUserNames(
      ctx.supabase,
      page.map((row) => row.reconhecido_por),
    );
    const oldest = page.at(-1);
    return {
      handoffs: page
        .slice()
        .reverse()
        .map((row) => ({
          ...row,
          reconhecido_por_nome: row.reconhecido_por
            ? (names.get(row.reconhecido_por) ?? null)
            : null,
        })),
      cursor:
        hasMore && oldest
          ? Buffer.from(
              JSON.stringify({ criado_em: oldest.criado_em, id: oldest.id }),
              "utf8",
            ).toString("base64url")
          : null,
      has_more: hasMore,
    };
  },
};

export const ATENDIMENTO_COMPLETO_MCP_TOOLS = [
  crmGetMessage,
  crmCloseConversation,
  crmReopenConversation,
  crmMarkConversationRead,
  crmListInternalNotes,
  crmCreateInternalNote,
  crmDeleteInternalNote,
  crmListMessagingChannels,
  crmListHandoffHistory,
] as const;
