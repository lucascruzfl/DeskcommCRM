import { type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { getImportBatchHandler } from "@/lib/crm-b2b/import-handlers";
import {
  ctxFromAuthz,
  handleRouteError,
  ok,
  requestIdOf,
  seModuloB2bDesligado,
} from "@/lib/crm-b2b/route-helpers";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx): Promise<Response> {
  const requestId = requestIdOf(req);
  const desligado = await seModuloB2bDesligado(requestId);
  if (desligado) return desligado;
  const authz = await requireRole("viewer", { requestId, resource: "imports" });
  if (!authz.ok) return authz.response;
  const { id } = await params;

  try {
    const supabase = await createClient();
    const result = await getImportBatchHandler(
      supabase, ctxFromAuthz(authz, requestId), id,
      req.nextUrl.searchParams.get("status") ?? undefined,
    );
    return ok(result, { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
