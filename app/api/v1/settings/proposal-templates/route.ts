import { ApiError } from "@/lib/api/types";
import {
  templatePostSchema as postSchema,
  writeProposalTemplateHandler,
} from "@/lib/propostas/modelos/escrita-administrativa";
// app/api/v1/settings/proposal-templates/route.ts
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import { listarModelosDaOrganizacao } from "@/lib/propostas/modelos/catalogo-da-organizacao";
import { sePropostasDesligadas } from "@/lib/propostas/porta";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "proposal_templates" });
  if (!authz.ok) return authz.response;
  const desligada = await sePropostasDesligadas(authz.org.orgId, requestId);
  if (desligada) return desligada;
  const admin = createAdminClient();
  return ok(await listarModelosDaOrganizacao(admin, authz.org.orgId), { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "proposal_templates" });
  if (!authz.ok) return authz.response;
  const desligada = await sePropostasDesligadas(authz.org.orgId, requestId);
  if (desligada) return desligada;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", t("Campos inválidos."), 422, { requestId });
  const admin = createAdminClient();

  try {
    return ok(
      await writeProposalTemplateHandler(
        admin,
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
      return fail(error.code, error.message, error.status, { requestId, details: error.details });
    throw error;
  }
}
