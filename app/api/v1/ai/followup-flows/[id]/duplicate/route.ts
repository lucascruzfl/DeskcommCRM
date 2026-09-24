import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/ai/followup-flows/:id/duplicate — clona o ponteiro (manager+).
 *
 * Copia rascunho (ou a versão no ar, se o rascunho estiver vazio), gatilho e
 * política de handoff. A cópia nasce SEMPRE `draft`, sem `active_version_id`:
 * duplicar não publica e não passa a mandar mensagem. Inscrições, versões e
 * vínculo com agente ficam no original — armar o clone no agente é o mesmo
 * passo extra da instalação de modelo.
 *
 * Nome recebe sufixo " (cópia)" (ou " (cópia N)" se o primeiro já existir).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { duplicarFluxo } from "@/lib/followup/duplicar-fluxo";
import { ApiError } from "@/lib/api/types";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) {
    return fail("invalid_request", "id inválido.", 400, { requestId });
  }

  const authz = await requireRole("manager", { requestId, resource: "followup_flows" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { user, org: activeOrg } = authz;

  const supabase = await createClient();
  let copia: { id: string };
  let nome: string;
  try {
    ({ copia, name: nome } = await duplicarFluxo(supabase, activeOrg.orgId, id, requestId));
  } catch (error) {
    if (error instanceof ApiError) {
      return fail(error.code, t(error.message), error.status, { requestId });
    }
    return fail("internal_error", "followup_flow_duplicate_failed", 500, { requestId });
  }

  void audit({
    action: "followup_flow.duplicated",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "followup_flow_pointer",
    resourceId: copia.id,
    requestId,
    metadata: { source_pointer_id: id, name: nome },
  });

  return ok(copia, { requestId, status: 201 });
}
