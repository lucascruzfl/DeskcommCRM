/**
 * MCP write tool — crm_start_conversation_and_send (Spec 11 §3.2, lacuna do
 * cold-start externo).
 *
 * A LACUNA QUE ISTO FECHA. `crm_send_whatsapp_message` só manda mensagem para
 * um `conversation_id` que JÁ EXISTE — não abre conversa nova. O único
 * caminho que abria conversa com um contato NOVO era `POST /api/v1/contacts`
 * (`createContactHandler`), que (a) é cookie-session-only — uma automação
 * externa com chave `dsk_...` não passa por ali — e (b) escolhe a sessão do
 * canal sozinha (`sessaoProntaParaEnvio`, "WORKING primeiro; senão qualquer
 * uma"): o chamador não tinha como dizer POR QUAL número sair. Uma automação
 * de prospecção fria (ex.: n8n captando lead novo) que precise abrir a
 * conversa NUM canal específico não tinha ferramenta MCP para isso.
 *
 * DOUTRINA DIRC (Referenciar, não duplicar) — esta tool não reimplementa
 * nada, só compõe duas peças que já existem e já são a origem autorizada:
 *   - `openSharedContactConversation` (lib/messaging/open-shared-contact-conversation.ts),
 *     o MESMO helper que `POST /api/v1/conversations/open-with-contact` usa:
 *     acha o contato pelas grafias do telefone (`encontrarContatoPorTelefone`)
 *     ou cria um novo (`fn_upsert_wa_contact`), e abre/reabre a conversa 1:1 na
 *     sessão indicada via `ensureConversation` → `beginServiceAtOrigin` →
 *     `fn_service_begin` — a RPC cujo próprio comentário de migration diz
 *     "nova iniciativa autorizada (humano/MCP/regra), chamada NA ORIGEM".
 *   - `sendMessageHandler` (app/api/v1/messages/_handler.ts), o MESMO handler
 *     que `crm_send_whatsapp_message` chama — nenhum código de envio novo,
 *     mesmas guardas (bloqueio, mídia, template, boundary de atendimento).
 *
 * Idempotência: mesmo padrão de `crm_send_whatsapp_message` (tabela
 * `idempotency_keys`, TTL 24h) — a chave cobre o PAR abrir-conversa+enviar,
 * não só o envio, porque um retry não pode abrir uma segunda conversa.
 */
import { z } from "zod";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { comIdempotencia } from "@/lib/api/idempotency";
import { openSharedContactConversation } from "@/lib/messaging/open-shared-contact-conversation";
import { validateOutboundMedia } from "@/lib/messaging/media/upload-validation";
import { depsDoRitmo, registrarEnvioPorToken, segurarEnvioPorToken } from "@/lib/messaging/ritmo-do-envio-por-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMessageSchema } from "@/lib/schemas/messaging";
import { McpToolError } from "../errors";
import type { McpToolDefinition } from "../types";

const ENDPOINT_TAG = "mcp:crm_start_conversation_and_send";

const inputShape = {
  /** O ganho central desta tool: quem chama ESCOLHE o canal, sem auto-seleção. */
  channel_session_id: z
    .string()
    .uuid()
    .describe(
      "Sessão de canal de onde a mensagem sai. Obrigatório — esta tool existe para deixar o chamador escolher, ao contrário da criação de contato pela tela, que pega qualquer canal WORKING.",
    ),
  contact_id: z.string().uuid().optional(),
  phone_number: z
    .string()
    .min(8)
    .max(32)
    .optional()
    .describe(
      "Usado para achar um contato existente pelas grafias do número, ou criar um novo se nenhum bater.",
    ),
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe("Nome do contato, usado só se um novo cadastro for criado."),
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
    .describe(
      "Chave estável obrigatória para reserva atômica do par abrir+enviar (24h). Use run_id+step.",
    ),
};

export const crmStartConversationAndSend: McpToolDefinition<typeof inputShape> = {
  name: "crm_start_conversation_and_send",
  description:
    "Abre uma conversa NOVA (ou reabre a existente) com um contato — existente via `contact_id`, " +
    "ou novo/achado pelo telefone via `phone_number` — num canal ESPECÍFICO escolhido em " +
    "`channel_session_id`, e envia a primeira mensagem. Use para iniciar contato com um lead que " +
    "ainda não tem conversa (ex.: automação de prospecção). Para responder numa conversa que já " +
    "existe, use `crm_send_whatsapp_message`. Forneça `idempotency_key` para evitar abrir a conversa " +
    "e mandar a mensagem em dobro num retry (TTL 24h).",
  inputSchema: inputShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "messages",
  capabilities: ["send_messages"],
  publicProfile: true,
  auditResource: (input, result) => ({
    type: "conversation",
    id: (result as { conversation_id?: string } | undefined)?.conversation_id ?? input.contact_id,
  }),
  handler: async (input, ctx) => {
    if (!input.contact_id && !input.phone_number?.trim()) {
      throw new Error("Informe contact_id ou phone_number.");
    }
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

    const corpo = {
      channel_session_id: input.channel_session_id,
      contact_id: input.contact_id,
      phone_number: input.phone_number,
      body: input.body,
      media_storage_path: input.media_storage_path,
      media_mime: input.media_mime,
      media_size_bytes: input.media_size_bytes,
      type: input.type,
      template_name: input.template_name,
      template_language: input.template_language,
      template_values: input.template_values,
    };
    const executar = async () => {
      // A mesma origem autorizada de open-with-contact decide reuso/reabertura.
      const opened = await openSharedContactConversation(ctx.supabase, ctx.organizationId, {
        channel_session_id: input.channel_session_id,
        contact_id: input.contact_id,
        phone_number: input.phone_number,
        name: input.name,
      });
      const parsed = sendMessageSchema.parse({
        conversation_id: opened.conversation_id,
        type: input.type,
        body: input.body,
        media_storage_path: input.media_storage_path,
        media_mime: input.media_mime,
        media_size_bytes: input.media_size_bytes,
        template_name: input.template_name,
        template_language: input.template_language,
        template_values: input.template_values,
      });
      const ritmo = await depsDoRitmo(createAdminClient());
      const segurado = await segurarEnvioPorToken(ritmo, {
        organizationId: ctx.organizationId,
        conversationId: opened.conversation_id,
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
          contact_id: opened.contact_id,
          conversation_id: opened.conversation_id,
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
      endpoint: ENDPOINT_TAG,
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
    return outcome.tipo === "replay"
      ? { ...outcome.resposta, deduplicated: true }
      : outcome.resposta;
  },
};
