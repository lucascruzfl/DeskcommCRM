import { z } from "zod";

import { McpToolError } from "@/lib/mcp/errors";
import type { McpToolDefinition } from "@/lib/mcp/types";
import { lerConfiguracao, restaurarSom } from "@/lib/notifications/configuracao-sons";
import { TIPOS_DE_SOM } from "@/lib/notifications/sons-da-org";

export const crmGetNotificationSounds: McpToolDefinition = {
  name: "crm_get_notification_sounds",
  description:
    "Consulta se cada aviso da Central usa som personalizado ou padrão. Não entrega arquivo, caminho nem URL assinada; upload de áudio é feito em Configurações > Notificações.",
  inputSchema: {},
  category: "read",
  requiresRole: "viewer",
  requiresScope: "mcp:read",
  domain: "settings",
  handler: async (_input, ctx) => {
    const atual = await lerConfiguracao(ctx.organizationId, ctx.supabase);
    if (!atual)
      throw new McpToolError("provider_unavailable", "Não consegui consultar os sons dos avisos.");
    return {
      sons: Object.fromEntries(
        TIPOS_DE_SOM.map((tipo) => [tipo, { personalizado: Boolean(atual.sons[tipo]) }]),
      ),
    };
  },
};

const resetShape = { tipo: z.enum(TIPOS_DE_SOM) };
export const crmResetNotificationSound: McpToolDefinition<typeof resetShape> = {
  name: "crm_reset_notification_sound",
  description:
    "Restaura o som padrão de um aviso da Central (venda ou pessoa) e remove o áudio personalizado. Mantém os avisos ativos e as outras configurações. Para voltar ao áudio anterior, envie o arquivo novamente pela tela de Notificações.",
  inputSchema: resetShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "settings",
  capabilities: ["destructive_operations"],
  auditResource: () => ({ type: "organization" }),
  handler: async (input, ctx) => {
    const { tipo } = z.object(resetShape).parse(input);
    if (!(await restaurarSom(ctx.organizationId, tipo, ctx.supabase))) {
      throw new McpToolError("provider_unavailable", "Não consegui restaurar o som do aviso.");
    }
    return { tipo, personalizado: false };
  },
};
