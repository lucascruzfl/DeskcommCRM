import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/api/v1/messages/_handler", () => ({ sendMessageHandler: vi.fn() }));
vi.mock("@/lib/api/idempotency", () => ({ comIdempotencia: vi.fn() }));

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { comIdempotencia } from "@/lib/api/idempotency";
import { crmReplyMessage, crmSendWhatsappMessage } from "@/lib/mcp/tools/messages";
import type { McpContext } from "@/lib/mcp/types";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = "22222222-2222-4222-8222-222222222222";
const MESSAGE = "33333333-3333-4333-8333-333333333333";

const context = {
  organizationId: ORG,
  role: "agent",
  actor: { type: "api_token", id: "token", role: "agent" },
  apiTokenId: "token",
  requestId: "request",
  supabase: {},
} as McpContext;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(comIdempotencia).mockImplementation(async (entry) => {
    const effect = await entry.executar();
    return { tipo: "executou", resposta: effect.resposta, status: effect.status };
  });
  vi.mocked(sendMessageHandler).mockResolvedValue({
    id: MESSAGE,
    status: "sent",
    external_id: "external",
    sent_at: "2026-09-20T12:00:00.000Z",
  } as never);
});

describe("envio MCP pela cadeia oficial", () => {
  it("envia mídia somente por storage path com metadados validados", async () => {
    await crmSendWhatsappMessage.handler(
      {
        conversation_id: CONVERSATION,
        type: "document",
        media_storage_path: `${ORG}/${CONVERSATION}/arquivo.pdf`,
        media_mime: "application/pdf",
        media_size_bytes: 100,
        idempotency_key: "media:1",
      },
      context,
    );
    expect(sendMessageHandler).toHaveBeenCalledWith(
      context.supabase,
      expect.objectContaining({ organization_id: ORG }),
      expect.objectContaining({
        conversation_id: CONVERSATION,
        media_storage_path: `${ORG}/${CONVERSATION}/arquivo.pdf`,
        media_mime: "application/pdf",
        media_size_bytes: 100,
      }),
    );
    expect(crmSendWhatsappMessage.inputSchema).not.toHaveProperty("media_url");
  });

  it("recusa tipo declarado diferente do MIME antes de enviar", async () => {
    await expect(
      crmSendWhatsappMessage.handler(
        {
          conversation_id: CONVERSATION,
          type: "image",
          media_storage_path: `${ORG}/${CONVERSATION}/arquivo.pdf`,
          media_mime: "application/pdf",
          media_size_bytes: 100,
          idempotency_key: "media:invalid",
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "validation_error", message: "media_type_mismatch" });
    expect(sendMessageHandler).not.toHaveBeenCalled();
  });

  it("preserva os campos oficiais de template", async () => {
    await crmSendWhatsappMessage.handler(
      {
        conversation_id: CONVERSATION,
        type: "template",
        body: "Olá, Ana",
        template_name: "boas_vindas",
        template_language: "pt_BR",
        template_values: { nome: "Ana" },
        idempotency_key: "template:1",
      },
      context,
    );
    expect(sendMessageHandler).toHaveBeenCalledWith(
      context.supabase,
      expect.anything(),
      expect.objectContaining({
        type: "template",
        template_name: "boas_vindas",
        template_language: "pt_BR",
        template_values: { nome: "Ana" },
      }),
    );
  });

  it("resposta citada passa o id interno ao handler canônico", async () => {
    await crmReplyMessage.handler(
      {
        conversation_id: CONVERSATION,
        reply_to_message_id: MESSAGE,
        body: "Resposta",
        type: "text",
        idempotency_key: "reply:1",
      },
      context,
    );
    expect(sendMessageHandler).toHaveBeenCalledWith(
      context.supabase,
      expect.anything(),
      expect.objectContaining({ reply_to_message_id: MESSAGE }),
    );
  });

  it("replay idempotente não executa envio outra vez", async () => {
    vi.mocked(comIdempotencia).mockResolvedValue({
      tipo: "replay",
      resposta: { message_id: MESSAGE, status: "sent", external_id: "external", sent_at: "agora" },
      status: 200,
    });
    const result = await crmSendWhatsappMessage.handler(
      { conversation_id: CONVERSATION, body: "Oi", type: "text", idempotency_key: "run:step" },
      context,
    );
    expect(result).toMatchObject({ message_id: MESSAGE, deduplicated: true });
    expect(sendMessageHandler).not.toHaveBeenCalled();
  });

  it("reserva simultânea retorna conflito retryable em vez de duplicar", async () => {
    vi.mocked(comIdempotencia).mockResolvedValue({ tipo: "em_curso" });
    await expect(
      crmSendWhatsappMessage.handler(
        { conversation_id: CONVERSATION, body: "Oi", type: "text", idempotency_key: "run:step" },
        context,
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "idempotency_in_progress",
      details: { retryable: true },
    });
    expect(sendMessageHandler).not.toHaveBeenCalled();
  });
});
