import { ApiError } from "@/lib/api/types";
import {
  templatePatchSchema as patchSchema,
  getProposalTemplateHandler,
  updateProposalTemplateHandler,
  deactivateProposalTemplateHandler,
} from "@/lib/propostas/modelos/administracao";
// app/api/v1/settings/proposal-templates/[slug]/route.ts
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import { sePropostasDesligadas } from "@/lib/propostas/porta";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ slug: string }> };
export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "proposal_templates" });
  if (!authz.ok) return authz.response;
  const desligada = await sePropostasDesligadas(authz.org.orgId, requestId);
  if (desligada) return desligada;
  const { slug } = await ctx.params;
  const admin = createAdminClient();

  try {
    return ok(
      await getProposalTemplateHandler(
        admin,
        {
          organization_id: authz.org.orgId,
          actor: { type: "user" as const, id: authz.user.id },
          requestId,
          idioma: authz.user.idioma,
        },
        slug,
      ),
      { requestId },
    );
  } catch (error) {
    if (error instanceof ApiError)
      return fail(error.code, error.message, error.status, { requestId, details: error.details });
    throw error;
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "proposal_templates" });
  if (!authz.ok) return authz.response;
  const desligada = await sePropostasDesligadas(authz.org.orgId, requestId);
  if (desligada) return desligada;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { slug } = await ctx.params;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", t("Campos inválidos."), 422, { requestId });
  const admin = createAdminClient();
  try {
    return ok(
      await updateProposalTemplateHandler(
        admin,
        {
          organization_id: authz.org.orgId,
          actor: { type: "user" as const, id: authz.user.id },
          requestId,
          idioma: authz.user.idioma,
        },
        slug,
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

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "proposal_templates" });
  if (!authz.ok) return authz.response;
  const desligada = await sePropostasDesligadas(authz.org.orgId, requestId);
  if (desligada) return desligada;
  const { slug } = await ctx.params;
  const admin = createAdminClient();

  try {
    return ok(
      await deactivateProposalTemplateHandler(
        admin,
        {
          organization_id: authz.org.orgId,
          actor: { type: "user" as const, id: authz.user.id },
          requestId,
          idioma: authz.user.idioma,
        },
        slug,
      ),
      { requestId },
    );
  } catch (error) {
    if (error instanceof ApiError)
      return fail(error.code, error.message, error.status, { requestId, details: error.details });
    throw error;
  }
}
