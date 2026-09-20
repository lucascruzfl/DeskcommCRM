import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/leads/[id]/clone — levar o negócio para OUTRO funil.
 *
 * É o caminho que a P-01 manda usar quando o alvo é outro funil: `/move` recusa
 * (422 `pipeline_immutable_use_clone`) e aponta para cá. Antes desta rota o
 * apontamento não existia em lugar nenhum do produto.
 *
 * A troca são DUAS escritas, nesta ordem de propósito:
 *  1. cria o clone no funil destino (via `createLeadHandler` — a MESMA porta da
 *     criação normal: valida etapa↔funil, calcula posição, aplica a regra de dono,
 *     emite `lead.created` e grava audit);
 *  2. encerra a origem via `encerraDemanda` com motivo canônico (P-03).
 *
 * A ordem é "clone primeiro" porque o banco não tem transação entre as duas: se a
 * segunda falhar, existe um negócio a mais no funil destino (visível, corrigível)
 * e a origem continua aberta. Na ordem inversa, uma falha na criação deixaria a
 * origem PERDIDA e sem sucessor — o operador perderia o negócio sem ver para onde
 * ele foi. A rota devolve 500 nesse caso, sem esconder a meia-execução.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import type { HandlerCtx } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { moverLeadParaOutroFunil } from "@/lib/leads/mover-para-funil";
import { cloneLeadSchema, validateRequest } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id: leadId } = await ctx.params;

  const supabase = await createClient();
  // spec 13 §4: escrita é agent+ (viewer é read-only).
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const handlerCtx: HandlerCtx = {
    organization_id: authz.org.orgId,
    actor: { type: "user", id: authz.user.id },
    requestId,
    idioma: authz.user.idioma,
  };

  try {
    const input = await validateRequest(cloneLeadSchema, req);

    const result = await moverLeadParaOutroFunil(supabase, handlerCtx, leadId, input);
    return ok(result, { requestId, status: 201 });
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }
}
