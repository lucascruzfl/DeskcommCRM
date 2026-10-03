import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { ApiError } from "@/lib/api/types";
import {
  proposalsSettingsSchema as patchSchema,
  getProposalSettingsHandler,
  updateProposalSettingsHandler,
} from "@/lib/propostas/configuracao-administrativa";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { traduzir } from "@/lib/i18n/dicionario";
import { moduloLigado } from "@/lib/instalacao/modulos";

export const dynamic = "force-dynamic";
/**
 * Doc 79: com o módulo desligado na INSTALAÇÃO, esta rota não existe — nenhuma
 * empresa vê nem liga Propostas. 404, o mesmo de `seModuloDesligado` do banco
 * externo. Vem depois do papel (403 antes de 404: não diz a quem não pode o
 * que está instalado).
 */
async function seModuloDesligado(requestId: string): Promise<Response | null> {
  if (await moduloLigado(createAdminClient(), "propostas")) return null;
  return fail("not_found", "Not found.", 404, { requestId });
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "settings_proposals" });
  if (!authz.ok) return authz.response;
  const desligado = await seModuloDesligado(requestId);
  if (desligado) return desligado;
  const supabase = await createClient();
  return ok(
    await getProposalSettingsHandler(supabase, {
      organization_id: authz.org.orgId,
      actor: { type: "user" as const, id: authz.user.id },
      requestId,
      idioma: authz.user.idioma,
    }),
    { requestId },
  );
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "settings_proposals" });
  if (!authz.ok) return authz.response;
  const desligado = await seModuloDesligado(requestId);
  if (desligado) return desligado;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", t("Campos inválidos."), 422, { requestId });

  // ADMIN CLIENT, nao createClient() — RLS de organizations so permite
  // UPDATE a platform_admin; um manager comum casaria 0 linhas em silencio
  // (issue #144, ver settings/routing/route.ts). O gate de papel acima
  // continua sendo a protecao real.
  const supabase = createAdminClient();
  try {
    return ok(
      await updateProposalSettingsHandler(
        supabase,
        {
          organization_id: authz.org.orgId,
          actor: { type: "user" as const, id: authz.user.id },
          requestId,
          idioma: authz.user.idioma,
        },
        parsed.data,
      ),
      { requestId },
    );
  } catch (error) {
    if (error instanceof ApiError)
      return fail(error.code, t(error.message), error.status, { requestId });
    throw error;
  }
}
