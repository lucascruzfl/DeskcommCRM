import { randomUUID } from "node:crypto";
import { z } from "zod";

import { BUCKET_DE_CONHECIMENTO } from "@/lib/ai/rag/ingest/documento";
import { parseFaqMarkdown } from "@/lib/ai/rag/ingest/faq";
import { aceitaTextoColado, canonizarTipoDeFonte } from "@/lib/ai/rag/tipos-de-fonte";
import { McpToolError } from "@/lib/mcp/errors";
import type { McpContext, McpToolDefinition } from "@/lib/mcp/types";

const uuid = z.string().uuid();
const faqItem = z.object({
  question: z.string().trim().min(1).max(1000),
  answer: z.string().trim().min(1).max(20_000),
  tags: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  locale: z.string().trim().min(2).max(20).default("pt-BR"),
});

const SOURCE_COLUMNS =
  "id, agent_id, source_type, name, status, last_index_status, last_index_error, " +
  "last_indexed_at, chunks_count, is_active, source_metadata, active_kb_version_id, " +
  "ingested_at, created_at, updated_at";

function erro(
  code: ConstructorParameters<typeof McpToolError>[0],
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new McpToolError(code, message, details);
}

async function fonteDaOrg(ctx: McpContext, sourceId: string) {
  const { data, error } = await ctx.supabase
    .from("ai_knowledge_sources")
    .select(SOURCE_COLUMNS)
    .eq("organization_id", ctx.organizationId)
    .eq("id", sourceId)
    .maybeSingle();
  if (error) erro("not_allowed", "knowledge_source_read_failed");
  if (!data) erro("not_found", "Fonte de conhecimento não encontrada.");
  return data as unknown as Record<string, unknown>;
}

async function emitirIndexacao(
  ctx: McpContext,
  fonte: Record<string, unknown>,
  triggeredBy: string,
) {
  const { error } = await ctx.supabase.rpc(
    "emit_event" as never,
    {
      p_event_type: "knowledge_source.updated",
      p_entity_kind: "ai_knowledge_source",
      p_entity_id: fonte.id,
      p_payload: {
        knowledge_source_id: fonte.id,
        agent_id: fonte.agent_id ?? null,
        source_type: fonte.source_type,
        triggered_by: triggeredBy,
      },
      p_organization_id: ctx.organizationId,
    } as never,
  );
  if (error) erro("not_allowed", "Não foi possível enfileirar a indexação.");
}

function estadoDeIndexacao(fonte: Record<string, unknown>) {
  const estado = fonte.last_index_status;
  if (estado === "indexando") return "processing";
  if (estado === "failed" || estado === "partial" || estado === "sem_credencial") return "failed";
  if (fonte.active_kb_version_id && Number(fonte.chunks_count ?? 0) > 0) return "ready";
  return "pending";
}

const getShape = { knowledge_source_id: uuid };
export const crmGetKnowledgeSource: McpToolDefinition<typeof getShape> = {
  name: "crm_get_knowledge_source",
  description:
    "Consulta uma fonte do acervo, seu conteúdo FAQ editável, metadados e o estado real de indexação. Não devolve embeddings.",
  inputSchema: getShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "knowledge",
  handler: async (input, ctx) => {
    const fonte = await fonteDaOrg(ctx, input.knowledge_source_id);
    const { data: items, error } = await ctx.supabase
      .from("ai_faq_items")
      .select("id, question, answer, tags, locale, position, created_at, updated_at")
      .eq("organization_id", ctx.organizationId)
      .eq("knowledge_source_id", input.knowledge_source_id)
      .order("position", { ascending: true });
    if (error) erro("not_allowed", "knowledge_faq_read_failed");
    return { fonte: { ...fonte, index_state: estadoDeIndexacao(fonte), items: items ?? [] } };
  },
};

const createShape = {
  name: z.string().trim().min(2).max(120),
  source_type: z.enum(["faq", "documento"]),
  items: z.array(faqItem).max(500).optional(),
  markdown_content: z.string().trim().min(1).max(500_000).optional(),
  source_metadata: z.record(z.string(), z.unknown()).default({}),
};
export const crmCreateKnowledgeSource: McpToolDefinition<typeof createShape> = {
  name: "crm_create_knowledge_source",
  description:
    "Cria material textual no acervo. FAQ recebe items ou Markdown; documento recebe texto e segue o pipeline assíncrono oficial. Upload binário usa crm_get_knowledge_upload_instructions.",
  inputSchema: createShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "knowledge",
  auditResource: (_input, result) => ({
    type: "ai_knowledge_source",
    id: (result as { fonte?: { id?: string } })?.fonte?.id,
  }),
  handler: async (input, ctx) => {
    const tipo = canonizarTipoDeFonte(input.source_type);
    if (!tipo || !aceitaTextoColado(tipo))
      erro("validation_error", "Tipo de fonte não aceita conteúdo textual.");
    let items = input.items ?? [];
    if (tipo === "faq" && items.length === 0 && input.markdown_content) {
      items = parseFaqMarkdown(input.markdown_content);
    }
    if (tipo === "faq" && items.length === 0)
      erro("validation_error", "FAQ exige ao menos uma pergunta e resposta.");
    if (tipo === "documento" && !input.markdown_content)
      erro("validation_error", "Documento textual exige markdown_content.");

    let metadata: Record<string, unknown> = { ...input.source_metadata };
    let blobPath: string | null = null;
    if (tipo === "documento") {
      blobPath = `${ctx.organizationId}/${randomUUID()}.md`;
      const { error } = await ctx.supabase.storage
        .from(BUCKET_DE_CONHECIMENTO)
        .upload(blobPath, Buffer.from(input.markdown_content!, "utf8"), {
          contentType: "text/markdown",
          upsert: false,
        });
      if (error) erro("not_allowed", "Não foi possível guardar o documento.");
      metadata = { ...metadata, blob_path: blobPath, ext: "md", origem: "texto_colado" };
    }

    const { data: created, error } = await ctx.supabase
      .from("ai_knowledge_sources")
      .insert({
        organization_id: ctx.organizationId,
        source_type: tipo,
        name: input.name,
        status: "ready",
        is_active: true,
        source_metadata: metadata,
        ingested_at: new Date().toISOString(),
      })
      .select(SOURCE_COLUMNS)
      .single();
    if (error || !created) {
      if (blobPath) await ctx.supabase.storage.from(BUCKET_DE_CONHECIMENTO).remove([blobPath]);
      if (error?.code === "23505") erro("conflict", "Já existe material ativo com esse nome.");
      erro("not_allowed", "Não foi possível criar o material.");
    }
    const fonteCriada = created as unknown as Record<string, unknown>;
    if (tipo === "faq") {
      const rows = items.map((item, position) => ({
        organization_id: ctx.organizationId,
        knowledge_source_id: fonteCriada.id,
        ...item,
        position,
      }));
      const { error: itemError } = await ctx.supabase.from("ai_faq_items").insert(rows);
      if (itemError) {
        await ctx.supabase
          .from("ai_knowledge_sources")
          .delete()
          .eq("organization_id", ctx.organizationId)
          .eq("id", fonteCriada.id);
        erro("not_allowed", "Não foi possível gravar a FAQ.");
      }
    }
    await emitirIndexacao(ctx, fonteCriada, "mcp_create");
    return {
      fonte: { ...fonteCriada, index_state: "pending" },
      items_count: items.length,
      indexacao_solicitada: true,
    };
  },
};

const updateShape = {
  knowledge_source_id: uuid,
  name: z.string().trim().min(2).max(120).optional(),
  source_metadata: z.record(z.string(), z.unknown()).optional(),
};
export const crmUpdateKnowledgeSource: McpToolDefinition<typeof updateShape> = {
  name: "crm_update_knowledge_source",
  description:
    "Atualiza nome ou metadados não sensíveis de uma fonte. Conteúdo FAQ é substituído atomicamente pela tool específica.",
  inputSchema: updateShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "knowledge",
  auditResource: (input) => ({ type: "ai_knowledge_source", id: input.knowledge_source_id }),
  handler: async (input, ctx) => {
    await fonteDaOrg(ctx, input.knowledge_source_id);
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.source_metadata !== undefined) patch.source_metadata = input.source_metadata;
    if (Object.keys(patch).length === 0)
      erro("validation_error", "Informe ao menos um campo para atualizar.");
    const { data, error } = await ctx.supabase
      .from("ai_knowledge_sources")
      .update(patch)
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.knowledge_source_id)
      .select(SOURCE_COLUMNS)
      .single();
    if (error?.code === "23505") erro("conflict", "Já existe material ativo com esse nome.");
    if (error || !data) erro("not_allowed", "Não foi possível atualizar o material.");
    return { fonte: data };
  },
};

const replaceFaqShape = { knowledge_source_id: uuid, items: z.array(faqItem).min(1).max(500) };
export const crmReplaceKnowledgeFaq: McpToolDefinition<typeof replaceFaqShape> = {
  name: "crm_replace_knowledge_faq",
  description:
    "Substitui o conjunto inteiro de perguntas e respostas em uma única transação e solicita nova indexação. Nunca deixa a FAQ pela metade.",
  inputSchema: replaceFaqShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "knowledge",
  auditResource: (input) => ({ type: "ai_knowledge_source", id: input.knowledge_source_id }),
  handler: async (input, ctx) => {
    const fonte = await fonteDaOrg(ctx, input.knowledge_source_id);
    if (canonizarTipoDeFonte(String(fonte.source_type)) !== "faq")
      erro("validation_error", "A fonte não é uma FAQ.");
    const { data, error } = await ctx.supabase.rpc(
      "fn_replace_knowledge_faq_items" as never,
      {
        p_organization_id: ctx.organizationId,
        p_knowledge_source_id: input.knowledge_source_id,
        p_items: input.items,
      } as never,
    );
    if (error) erro("not_allowed", "Não foi possível substituir a FAQ atomicamente.");
    await emitirIndexacao(ctx, fonte, "mcp_faq_replace");
    return {
      knowledge_source_id: input.knowledge_source_id,
      items_count: Number(data ?? input.items.length),
      indexacao_solicitada: true,
    };
  },
};

const reindexShape = { knowledge_source_id: uuid };
export const crmReindexKnowledgeSource: McpToolDefinition<typeof reindexShape> = {
  name: "crm_reindex_knowledge_source",
  description:
    "Solicita reindexação pelo event_log e worker oficial. Não calcula embeddings dentro da chamada MCP.",
  inputSchema: reindexShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "knowledge",
  auditResource: (input) => ({ type: "ai_knowledge_source", id: input.knowledge_source_id }),
  handler: async (input, ctx) => {
    const fonte = await fonteDaOrg(ctx, input.knowledge_source_id);
    if (!fonte.is_active || fonte.status === "archived")
      erro("conflict", "Material arquivado não pode ser reindexado.");
    await ctx.supabase
      .from("ai_knowledge_sources")
      .update({ last_index_error: null })
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.knowledge_source_id);
    await emitirIndexacao(ctx, fonte, "mcp_reindex");
    return {
      knowledge_source_id: input.knowledge_source_id,
      indexacao_solicitada: true,
      estado_atual: estadoDeIndexacao(fonte),
    };
  },
};

const archiveShape = { knowledge_source_id: uuid };
export const crmArchiveKnowledgeSource: McpToolDefinition<typeof archiveShape> = {
  name: "crm_archive_knowledge_source",
  description:
    "Arquiva logicamente uma fonte e a retira do acervo ativo, preservando histórico e vínculos antigos.",
  inputSchema: archiveShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "knowledge",
  capabilities: ["destructive_operations"],
  auditResource: (input) => ({ type: "ai_knowledge_source", id: input.knowledge_source_id }),
  handler: async (input, ctx) => {
    await fonteDaOrg(ctx, input.knowledge_source_id);
    const { data, error } = await ctx.supabase
      .from("ai_knowledge_sources")
      .update({ status: "archived", is_active: false })
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.knowledge_source_id)
      .select("id, status, is_active")
      .single();
    if (error || !data) erro("not_allowed", "Não foi possível arquivar o material.");
    return { fonte: data };
  },
};

const uploadShape = {};
export const crmGetKnowledgeUploadInstructions: McpToolDefinition<typeof uploadShape> = {
  name: "crm_get_knowledge_upload_instructions",
  description:
    "Informa como concluir upload binário no endpoint bearer oficial. Não transporta base64 nem cria um canal paralelo de arquivos.",
  inputSchema: uploadShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "knowledge",
  handler: async () => ({
    human_action_required: true,
    reason: "binary_upload_requires_official_endpoint",
    instruction:
      "Envie multipart/form-data para /api/v1/ai/knowledge/sources/upload usando a sessão web autorizada; depois consulte a fonte pelo MCP.",
    endpoint: "/api/v1/ai/knowledge/sources/upload",
    accepted_extensions: ["pdf", "md", "txt", "csv"],
  }),
};

export const KNOWLEDGE_ADMIN_MCP_TOOLS = [
  crmGetKnowledgeSource,
  crmCreateKnowledgeSource,
  crmUpdateKnowledgeSource,
  crmReplaceKnowledgeFaq,
  crmReindexKnowledgeSource,
  crmArchiveKnowledgeSource,
  crmGetKnowledgeUploadInstructions,
] as const;
