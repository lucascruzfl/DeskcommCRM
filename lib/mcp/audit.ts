/**
 * Audit log dedicado para tool calls MCP.
 *
 * Spec 11 §6: cada tool call gera 1 entrada em `api_audit_log` com
 * `action='mcp.tool_called'`, `actor_type='ai_agent'` (quando aplicavel),
 * `actor_api_token_id=<token>`, `resource_type='mcp_tool'`, `resource_id=<tool_name>`.
 *
 * Fire-and-forget: falha de write nunca bloqueia retorno da tool.
 */
import { audit } from "@/lib/audit";
import type { McpContext } from "./types";

interface AuditMcpToolCallInput {
  ctx: McpContext;
  toolName: string;
  args: Record<string, unknown>;
  durationMs: number;
  success: boolean;
  errorCode?: string;
}

// Lista positiva: nunca registrar busca, corpo, telefone, email, nome, motivo,
// descricao, tags ou campos customizados. IDs tecnicos bastam para investigar.
const TECHNICAL_ID_KEYS = new Set([
  "contact_id",
  "conversation_id",
  "lead_id",
  "pipeline_id",
  "stage_id",
  "after_stage_id",
  "move_leads_to_stage_id",
  "to_stage_id",
  "target_id",
  "to_user_id",
]);

function technicalIds(args: Record<string, unknown>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(args)) {
    if (!TECHNICAL_ID_KEYS.has(key)) continue;
    if (value === null || (typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value))) {
      out[key] = value;
    }
  }
  return out;
}

export async function auditMcpToolCall(input: AuditMcpToolCallInput): Promise<void> {
  const { ctx, toolName, args, durationMs, success, errorCode } = input;

  const metadata: Record<string, unknown> = {
    actor_type: ctx.actor.type,
    actor_id: ctx.actor.id,
    tool_name: toolName,
    resource_ids: technicalIds(args),
    duration_ms: durationMs,
    success,
  };

  if (errorCode) metadata.error_code = errorCode.slice(0, 120);
  if (ctx.actor.type === "ai_agent" && ctx.actor.api_token_id) {
    metadata.actor_api_token_id = ctx.actor.api_token_id;
  }

  await audit({
    action: "mcp.tool_called",
    // Quem age via MCP é um TOKEN, nunca uma linha de auth.users: para um token
    // comum, ctx.actor.id é o id do próprio token (lib/mcp/auth.ts), e mandá-lo
    // como actorUserId estourava a FK api_audit_log_actor_user_id_fkey. O ator
    // já fica registrado em actorApiTokenId e em metadata.actor_id.
    actorUserId: null,
    actorApiTokenId: ctx.apiTokenId,
    organizationId: ctx.organizationId,
    resourceType: "mcp_tool",
    // `resource_id` é uuid no banco; o nome da tool ia aqui como texto e o
    // insert morria com "invalid input syntax for type uuid: crm_create_lead".
    // O nome já viaja em metadata.tool_name, que é jsonb.
    resourceId: null,
    requestId: ctx.requestId,
    metadata,
  });
}
