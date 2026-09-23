/**
 * MCP write tool — crm_send_whatsapp_message (Spec 11 §3.2).
 *
 * Wrappa `sendMessageHandler` com camada de idempotência (tabela
 * `idempotency_keys`). Se o mesmo `idempotency_key` for invocado de novo,
 * retorna o `message_id` cacheado sem inserir/enviar de novo.
 */
import { z } from "zod";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { comIdempotencia } from "@/lib/api/idempotency";
import { validateOutboundMedia } from "@/lib/messaging/media/upload-validation";
import { depsDoRitmo, registrarEnvioPorToken, segurarEnvioPorToken } from "@/lib/messaging/ritmo-do-envio-por-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMessageSchema } from "@/lib/schemas/messaging";
import { McpToolError } from "../errors";
import type { McpContext, McpToolDefinition } from "../types";

const ENDPOINT_TAG = "mcp:crm_send_whatsapp_message";

const inputShape = {
  conversation_id: z.string().uuid(),
  body: z.string().min(1).max(4096).optional(),
  media_storage_path: z.string().min(1).max(500).optional(),
  media_mime: z.string().optional(),
  media_size_bytes: z.number().int().positive().optional(),
  type: z
    .enum([
      "text",
      "image",
      "audio",
      "document",
      "sticker",
      "video",
      "location",
      "contact",
      "template",
    ])
    .optional()
    .default("text"),
  template_name: z.string().min(1).max(512).optional(),
  template_language: z.string().min(2).max(16).optional(),
  template_values: z.record(z.string(), z.string()).optional(),
  idempotency_key: z
    .string()
    .min(1)
    .max(200)
    .describe("Chave estável obrigatória para deduplicação atômica (24h). Use run_id+step."),
};

type SendResponse = {
  message_id: string;
  status: string;
  external_id: string | null;
  sent_at: string;
};

async function enviar(
  input: z.infer<z.ZodObject<typeof inputShape>>,
  ctx: McpContext,
  replyToMessageId?: string,
): Promise<SendResponse & { deduplicated?: boolean }> {
  if (input.media_storage_path) {
    if (!input.media_mime || !input.media_size_bytes) {
      throw new McpToolError("validation_error", "media_metadata_required");
    }
    const verdict = validateOutboundMedia(input.media_mime, input.media_size_bytes);
    if (!verdict.ok) throw new McpToolError("validation_error", verdict.code);
    const stickerValido =
      input.type === "sticker" &&
      verdict.kind === "image" &&
      input.media_mime.split(";")[0]?.trim().toLowerCase() === "image/webp";
    if (input.type !== verdict.kind && !stickerValido) {
      throw new McpToolError("validation_error", "media_type_mismatch");
    }
  }
  const parsed = sendMessageSchema.parse({
    conversation_id: input.conversation_id,
    type: input.type,
    body: input.body,
    media_storage_path: input.media_storage_path,
    media_mime: input.media_mime,
    media_size_bytes: input.media_size_bytes,
    template_name: input.template_name,
    template_language: input.template_language,
    template_values: input.template_values,
    reply_to_message_id: replyToMessageId,
  });
  const corpo = {
    conversation_id: parsed.conversation_id,
    body: parsed.body,
    media_storage_path: parsed.media_storage_path,
    media_mime: parsed.media_mime,
    media_size_bytes: parsed.media_size_bytes,
    template_name: parsed.template_name,
    template_language: parsed.template_language,
    template_values: parsed.template_values,
    type: parsed.type,
    reply_to_message_id: parsed.reply_to_message_id,
  };
  const executar = async () => {
    const ritmo = await depsDoRitmo(createAdminClient());
    const segurado = await segurarEnvioPorToken(ritmo, {
      organizationId: ctx.organizationId,
      conversationId: parsed.conversation_id,
      requestId: ctx.requestId,
    });
    const message = await sendMessageHandler(
      ctx.supabase,
      { organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId },
      parsed,
    );
    await registrarEnvioPorToken(ritmo, ctx.organizationId, segurado, message.status);
    return {
      resposta: {
        message_id: message.id,
        status: message.status,
        external_id: message.external_id,
        sent_at: message.sent_at,
      },
      status: 200,
    };
  };

  const outcome = await comIdempotencia({
    db: ctx.supabase,
    organizationId: ctx.organizationId,
    endpoint: replyToMessageId ? "mcp:crm_reply_message" : ENDPOINT_TAG,
    chave: input.idempotency_key,
    corpo,
    executar,
  });
  if (outcome.tipo === "conflito") {
    throw new McpToolError("conflict", "idempotency_conflict", {
      idempotency_key: input.idempotency_key,
    });
  }
  if (outcome.tipo === "em_curso") {
    throw new McpToolError("conflict", "idempotency_in_progress", {
      idempotency_key: input.idempotency_key,
      retryable: true,
    });
  }
  return outcome.tipo === "replay" ? { ...outcome.resposta, deduplicated: true } : outcome.resposta;
}

export const crmSendWhatsappMessage: McpToolDefinition<typeof inputShape> = {
  name: "crm_send_whatsapp_message",
  description:
    "Envia texto, template ou mídia já armazenada para uma conversa existente pelo serviço oficial do canal. Para mídia, use somente `media_storage_path` devolvido pelo upload oficial da própria conversa; a tool valida tipo, tamanho e ownership e nunca aceita URL privada arbitrária. Forneça `idempotency_key` estável para impedir envio duplicado em retries concorrentes.",
  inputSchema: inputShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  domain: "messages",
  capabilities: ["send_messages"],
  publicProfile: true,
  auditResource: (input, result) => ({
    type: "message",
    id: (result as { message_id?: string } | undefined)?.message_id ?? input.conversation_id,
  }),
  handler: async (input, ctx) => {
    return enviar(input, ctx);
  },
};

const replyInputShape = {
  ...inputShape,
  reply_to_message_id: z.string().uuid(),
};

export const crmReplyMessage: McpToolDefinition<typeof replyInputShape> = {
  name: "crm_reply_message",
  description:
    "Responde citando uma mensagem específica da mesma conversa. O serviço oficial valida tenant e vínculo conversation↔message, preserva reply_to_message_id no histórico e traduz a citação para o identificador do canal quando suportado. Exige `capability:send_messages`; use `idempotency_key` estável em retries.",
  inputSchema: replyInputShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  domain: "messages",
  capabilities: ["send_messages"],
  publicProfile: true,
  auditResource: (input, result) => ({
    type: "message",
    id: (result as { message_id?: string } | undefined)?.message_id ?? input.reply_to_message_id,
  }),
  handler: async (input, ctx) => enviar(input, ctx, input.reply_to_message_id),
};
