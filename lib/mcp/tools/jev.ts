import { estadoDoJevParaMcp, lerEstadoDoJev } from "@/lib/ai/decisao/status";
import { McpToolError } from "@/lib/mcp/errors";
import type { McpToolDefinition } from "@/lib/mcp/types";

/** Somente o read-side. Ativação, aceite e decisões operacionais continuam humanos. */
export const crmGetJevStatus: McpToolDefinition<Record<never, never>> = {
  name: "crm_get_jev_status",
  description:
    "Consulta estado efetivo das seis tarefas do Jev, restrições, novidade, observação e métricas agregadas da organização. Não muda decisões e não retorna mensagens, credenciais ou prompts.",
  inputSchema: {},
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "ai",
  auditResource: () => ({ type: "ai_jev" }),
  redigirParaAuditoria: () => ({ operation_kind: "jev_status_read" }),
  redigirErroParaAuditoria: () => "jev_status_read_failed",
  handler: async (_input, ctx) => {
    try {
      return estadoDoJevParaMcp(await lerEstadoDoJev(ctx.supabase, ctx.organizationId));
    } catch {
      throw new McpToolError("not_allowed", "jev_status_read_failed");
    }
  },
};
