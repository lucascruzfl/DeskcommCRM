import { ApiError } from "@/lib/api/types";
import {
  revisionCreateSchema as bodySchema,
  createProposalRevisionHandler,
} from "@/lib/propostas/revisao-administrativa";
/**
 * POST /api/v1/proposals/[id]/revise — D4. Cria a v2 em RASCUNHO a partir de
 * uma proposta ENVIADA: copia titulo/condicoes/valid_until/itens, herda
 * numero/ano, aponta substitui_id para a v1. A v1 CONTINUA `enviada` — só
 * vira `substituida` quando a v2 for efetivamente enviada
 * (app/api/v1/proposals/[id]/send/route.ts).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { sePropostasDesligadas } from "@/lib/propostas/porta";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "crm_proposals" });
  if (!authz.ok) return authz.response;
  const desligada = await sePropostasDesligadas(authz.org.orgId, requestId);
  if (desligada) return desligada;
  const { id } = await ctx.params;
  const parsedBody = bodySchema.safeParse(await req.json().catch(() => ({})));
  const motivo = parsedBody.success ? (parsedBody.data.motivo ?? null) : null;
  const admin = createAdminClient();

  try {
    return ok(
      await createProposalRevisionHandler(
        admin,
        {
          organization_id: authz.org.orgId,
          actor: { type: "user" as const, id: authz.user.id },
          requestId,
          idioma: authz.user.idioma,
        },
        id,
        motivo,
      ),
      { requestId, status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiError)
      return fail(error.code, error.message, error.status, { requestId, details: error.details });
    throw error;
  }
}
