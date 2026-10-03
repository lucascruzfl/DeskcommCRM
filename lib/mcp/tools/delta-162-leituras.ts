import { z } from "zod";
import type { McpToolDefinition } from "../types";
import { criarDepsDeGrupos, listarGruposDoNumero } from "@/lib/grupos/servico";
import { queryKnowledgeHandler } from "@/lib/ai/knowledge/consulta-administrativa";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
const groupShape = { channel_session_id: z.string().uuid() };
export const crmListChannelGroups: McpToolDefinition<typeof groupShape> = {
  name: "crm_list_channel_groups",
  description:
    "Consulta os grupos presentes e órfãos ligados do número desta organização, usando a leitura canônica do canal. Não liga grupos, altera filtro, envia mensagem ou devolve credenciais.",
  inputSchema: groupShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "channels",
  redigirParaAuditoria: (args) => ({ channel_session_id_present: !!args.channel_session_id }),
  redigirErroParaAuditoria: () => "channel_groups_query_error",
  auditResource: () => ({ type: "channel_session_groups" }),
  handler: async (raw, ctx) => {
    const input = z.object(groupShape).strict().parse(raw);
    return {
      groups: await listarGruposDoNumero(criarDepsDeGrupos(ctx.supabase), {
        organizationId: ctx.organizationId,
        channelSessionId: input.channel_session_id,
      }),
    };
  },
};
const knowledgeShape = {
  pergunta: z.string().trim().min(2).max(1000),
  agent_id: z.string().uuid().optional(),
  quantidade: z.number().int().min(1).max(10).default(6),
};
export const crmSearchOrganizationKnowledge: McpToolDefinition<typeof knowledgeShape> = {
  name: "crm_search_organization_knowledge",
  description:
    "Consulta o acervo publicado da organização inteira, ou o acervo/limiar de um assistente informado. Devolve trechos canônicos e motivo de ausência; não gera sugestão de IA. Consome embedding na credencial já configurada; teto por token e organização, sem alterar provedor ou material.",
  inputSchema: knowledgeShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "knowledge",
  redigirParaAuditoria: (args) => ({
    agent_id_present: !!args.agent_id,
    question_present: typeof args.pergunta === "string",
    quantidade: typeof args.quantidade === "number" ? args.quantidade : 6,
  }),
  redigirErroParaAuditoria: () => "organization_knowledge_query_error",
  auditResource: () => ({ type: "knowledge_searches" }),
  handler: async (raw, ctx) => {
    const input = z.object(knowledgeShape).strict().parse(raw);
    const [token, org] = await Promise.all([
      checkRateLimit(`acervo-busca-mcp:${ctx.apiTokenId}`, 12, 60),
      checkRateLimit(`acervo-busca-org:${ctx.organizationId}`, 60, 60),
    ]);
    if (!token.allowed || !org.allowed) throw new Error("knowledge_query_rate_limited");
    return queryKnowledgeHandler(
      ctx.supabase,
      { organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId },
      { pergunta: input.pergunta, agentId: input.agent_id, quantidade: input.quantidade },
    );
  },
};
export const DELTA_162_READ_TOOLS = [
  crmListChannelGroups,
  crmSearchOrganizationKnowledge,
] as unknown as ReadonlyArray<McpToolDefinition>;
