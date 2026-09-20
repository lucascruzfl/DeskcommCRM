import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/api/v1/conversations/_handler", () => ({
  getConversationHandler: vi.fn(),
  markConversationReadHandler: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/atendimento/notas-da-conversa", () => ({
  listarNotasDaConversa: vi.fn(),
  criarNotaDaConversa: vi.fn(),
  removerNotaDaConversa: vi.fn(),
}));
vi.mock("@/lib/channels/selectable", () => ({ listSelectableChannels: vi.fn() }));
vi.mock("@/lib/mcp/tools/_users", () => ({ resolveUserNames: vi.fn() }));

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
import {
  ATENDIMENTO_COMPLETO_MCP_TOOLS,
  crmCloseConversation,
  crmCreateInternalNote,
  crmDeleteInternalNote,
  crmGetMessage,
  crmListInternalNotes,
  crmListMessagingChannels,
  crmMarkConversationRead,
  crmReopenConversation,
} from "@/lib/mcp/tools/atendimento-completo";
import { resolveUserNames } from "@/lib/mcp/tools/_users";
import type { McpContext } from "@/lib/mcp/types";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = "22222222-2222-4222-8222-222222222222";
const MESSAGE = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";

function ctx(supabase: unknown = {}): McpContext {
  return {
    organizationId: ORG,
    role: "manager",
    actor: { type: "api_token", id: "token", role: "manager" },
    apiTokenId: "token",
    provisionedByUserId: USER,
    requestId: "request",
    supabase,
  } as McpContext;
}

beforeEach(() => vi.clearAllMocks());

describe("registry de atendimento completo", () => {
  it("declara domínio, capability, perfil público e recurso auditável em toda tool nova", () => {
    expect(ATENDIMENTO_COMPLETO_MCP_TOOLS).toHaveLength(9);
    for (const tool of ATENDIMENTO_COMPLETO_MCP_TOOLS) {
      expect(tool.domain).toBeTruthy();
      expect(tool.capabilities).toBeDefined();
      expect(tool.publicProfile).toBe(true);
      expect(tool.auditResource).toBeTypeOf("function");
      expect(tool.description.length).toBeGreaterThan(80);
    }
  });
});

describe("estado canônico da conversa", () => {
  it.each([
    [crmCloseConversation, "closed", "conversation.closed"],
    [crmReopenConversation, "open", "conversation.released"],
  ] as const)("%s usa fn_service_status com tenant e revisão", async (tool, status, action) => {
    vi.mocked(getConversationHandler).mockResolvedValue({ service_revision: 7 } as never);
    const rpc = vi.fn().mockResolvedValue({ data: { id: CONVERSATION, status }, error: null });
    const result = await tool.handler(
      { conversation_id: CONVERSATION, expected_revision: 7 },
      ctx({ rpc }),
    );

    expect(rpc).toHaveBeenCalledWith("fn_service_status", {
      p_org: ORG,
      p_conversation: CONVERSATION,
      p_status: status,
      p_expected: 7,
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action,
        organizationId: ORG,
        resourceId: CONVERSATION,
      }),
    );
    expect(result).toMatchObject({ conversation_id: CONVERSATION, status });
  });

  it("mark-read delega ao handler oficial com organization_id do contexto", async () => {
    vi.mocked(markConversationReadHandler).mockResolvedValue({ id: CONVERSATION } as never);
    const supabase = {};
    await crmMarkConversationRead.handler({ conversation_id: CONVERSATION }, ctx(supabase));
    expect(markConversationReadHandler).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ organization_id: ORG }),
      CONVERSATION,
    );
  });
});

describe("mensagens e canais sem vazamento", () => {
  it("consulta mensagem filtrando tenant e não devolve URL/path privado", async () => {
    const filters: Array<[string, unknown]> = [];
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((key: string, value: unknown) => {
        filters.push([key, value]);
        return query;
      }),
      maybeSingle: vi.fn(async () => ({
        data: {
          id: MESSAGE,
          body: "olá",
          media_url: "https://privado.exemplo/signed?token=segredo",
          media_storage_path: `${ORG}/${CONVERSATION}/arquivo.pdf`,
        },
        error: null,
      })),
    };
    const result = (await crmGetMessage.handler(
      { message_id: MESSAGE },
      ctx({ from: () => query }),
    )) as Record<string, unknown>;
    expect(filters).toContainEqual(["organization_id", ORG]);
    expect(result.media_available).toBe(true);
    expect(result).not.toHaveProperty("media_url");
    expect(result).not.toHaveProperty("media_storage_path");
    expect(JSON.stringify(result)).not.toContain("segredo");
  });

  it("descobre disponibilidade e ação humana sem nomes internos ou secrets", async () => {
    vi.mocked(listSelectableChannels).mockResolvedValue([
      {
        id: "55555555-5555-4555-8555-555555555555",
        display_name: "Comercial",
        phone_number: "5511999999999",
        status: "WORKING",
        aceitaMensagemLivre: true,
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        display_name: "Novo número",
        phone_number: null,
        status: "SCAN_QR_CODE",
        aceitaMensagemLivre: true,
      },
    ]);
    const result = await crmListMessagingChannels.handler({ only_sendable: false }, ctx({}));
    const text = JSON.stringify(result);
    expect(result).toMatchObject({ available_count: 1 });
    expect(text).toContain('"human_action_required":true');
    expect(text).not.toMatch(/waha_session_name|api_key|secret|token/i);
  });
});

describe("notas internas", () => {
  it("lista pela operação compartilhada com tenant do contexto", async () => {
    vi.mocked(listarNotasDaConversa).mockResolvedValue([{ id: "nota" }] as never);
    const supabase = {};
    await crmListInternalNotes.handler({ conversation_id: CONVERSATION }, ctx(supabase));
    expect(listarNotasDaConversa).toHaveBeenCalledWith(supabase, ORG, CONVERSATION);
  });

  it("preserva o humano que provisionou o token e não põe o texto na auditoria MCP específica", async () => {
    vi.mocked(resolveUserNames).mockResolvedValue(new Map([[USER, "Ana"]]));
    vi.mocked(criarNotaDaConversa).mockResolvedValue({ id: "nota" } as never);
    await crmCreateInternalNote.handler(
      { conversation_id: CONVERSATION, body: "Somente a equipe lê" },
      ctx({}),
    );
    expect(criarNotaDaConversa).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        conversationId: CONVERSATION,
        authorUserId: USER,
        authorName: "Ana",
      }),
    );
  });

  it("remove pela operação canônica e exige destructive_operations", async () => {
    vi.mocked(removerNotaDaConversa).mockResolvedValue({ deleted: true, note_id: MESSAGE });
    expect(crmDeleteInternalNote.capabilities).toEqual(["destructive_operations"]);
    await crmDeleteInternalNote.handler(
      { conversation_id: CONVERSATION, note_id: MESSAGE },
      ctx({}),
    );
    expect(removerNotaDaConversa).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        conversationId: CONVERSATION,
        noteId: MESSAGE,
        actorUserId: USER,
      }),
    );
  });
});
