/**
 * Core do MCP server (Spec 11 §5.3).
 *
 * `createMcpServer(authResult, requestId)` retorna instancia `McpServer` com
 * todas as tools desta wave registradas. Cada tool e exposta com:
 *   - Zod raw shape como inputSchema (registerTool aceita ZodRawShape).
 *   - Handler async que (a) checa role + scope, (b) chama o handler da
 *     wave 2, (c) audita em api_audit_log, (d) retorna content[] padrao
 *     MCP. Erros viram `{ isError: true, content: [...] }` (e o codigo
 *     MCP fica no metadata, nao no JSON-RPC error envelope).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { auditMcpToolCall } from "./audit";
import { ensureRole, ensureScope, type McpAuthResult } from "./auth";
import { allTools } from "./tools";
import {
  authorizeMcpTool,
  publicToolPolicy,
  toolsAuthorizedForToken,
  type McpPublicRisk,
} from "./public-profile";
import { enforceMcpRateLimit } from "./rate-limit";
import { higienizarUuidsDeAterro } from "./uuid-de-aterro";
import type { McpContext } from "./types";

const SERVER_NAME = "deskcomm-crm";
const SERVER_VERSION = "0.1.0";

export function createMcpServer(auth: McpAuthResult, requestId: string): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  const supabase = createAdminClient();

  // O filtro acontece ANTES do registerTool: para token publico, uma tool sem
  // allowlist nem sequer aparece em tools/list. Tokens legados e o runtime
  // interno continuam vendo o catalogo completo.
  for (const tool of toolsAuthorizedForToken(allTools, auth.scopes)) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (rawArgs) => {
        const startedAt = Date.now();
        // A MESMA higiene do outro ingresso (`lib/ai/runtime/tools.ts`), pela
        // mesma razão: um uuid de aterro em campo opcional vira filtro por um
        // id que não existe, e o resultado vazio é lido como "não há". Aqui é o
        // caminho do MCP externo; lá é o do agente. Os dois entram no mesmo
        // handler, então os dois higienizam — deixar um de fora seria fechar a
        // porta e esquecer a janela. Ver `lib/mcp/uuid-de-aterro.ts`.
        const higiene = higienizarUuidsDeAterro(
          tool.inputSchema as Record<string, z.ZodTypeAny>,
          (rawArgs ?? {}) as Record<string, unknown>,
        );
        const args = higiene.limpos;
        const ctx: McpContext = {
          organizationId: auth.organizationId,
          role: auth.role,
          actor: auth.actor,
          apiTokenId: auth.apiTokenId,
          requestId,
          supabase,
        };

        try {
          const authorization = authorizeMcpTool(auth.scopes, tool.name);
          if (!authorization.ok) {
            throw new Error(
              authorization.missing
                ? `${authorization.reason}:${authorization.missing}`
                : authorization.reason,
            );
          }
          ensureScope(auth.scopes, tool.requiresScope);
          ensureRole(auth.role, tool.requiresRole);

          const publicPolicy = publicToolPolicy(tool.name);
          const risk: McpPublicRisk =
            publicPolicy?.risk ?? (tool.category === "read" ? "read" : "write");
          await enforceMcpRateLimit(auth.apiTokenId, risk);

          const result = await tool.handler(args as never, ctx);
          const durationMs = Date.now() - startedAt;

          await auditMcpToolCall({
            ctx,
            toolName: tool.name,
            args,
            durationMs,
            success: true,
          });

          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result as Record<string, unknown>,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : "unknown_error";
          const errorCode =
            err && typeof err === "object" && "code" in err && typeof err.code === "string"
              ? err.code
              : err instanceof Error
                ? err.name
                : "unknown_error";
          const durationMs = Date.now() - startedAt;

          await auditMcpToolCall({
            ctx,
            toolName: tool.name,
            args,
            durationMs,
            success: false,
            errorCode,
          });

          const details =
            err && typeof err === "object" && "details" in err && err.details && typeof err.details === "object"
              ? err.details as Record<string, unknown>
              : undefined;
          const structuredError = {
            error: {
              code: errorCode,
              message,
              ...(details ? { details } : {}),
            },
          };

          return {
            isError: true,
            content: [{ type: "text", text: JSON.stringify(structuredError) }],
            structuredContent: structuredError,
          };
        }
      },
    );
  }

  return server;
}
