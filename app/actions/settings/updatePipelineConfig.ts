"use server";

import { supportWriteError } from "@/lib/impersonate/support";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  pipelineConfigPatchSchema,
  type PipelineConfigPatch,
} from "@/lib/schemas/settings";
import { atualizarConfiguracaoDoFunil } from "@/lib/pipelines/pipeline-config-operations";
import { ApiError } from "@/lib/api/types";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";

export type UpdatePipelineConfigResult =
  | { ok: true }
  | { ok: false; error: string; details?: unknown };

export async function updatePipelineConfig(
  pipelineId: string,
  patch: PipelineConfigPatch,
): Promise<UpdatePipelineConfigResult> {
  if (!pipelineId || typeof pipelineId !== "string") {
    return { ok: false, error: "invalid_request" };
  }
  const parsed = pipelineConfigPatchSchema.safeParse(patch);
  if (!parsed.success) {
    return { ok: false, error: "validation_failed", details: parsed.error.flatten() };
  }

  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: "unauthenticated" };
  if (supportWriteError(authUser.support)) return { ok: false, error: "forbidden" };
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: "forbidden_tenant" };
  if (!authUser.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    return { ok: false, error: "forbidden_role" };
  }

  const supabase = await createClient();
  const hdrs = await headers();
  const requestId = hdrs.get("x-request-id");

  try {
    await atualizarConfiguracaoDoFunil(
      {
        supabase,
        organizationId: activeOrg.orgId,
        actor: { type: "user", id: authUser.id },
        requestId: requestId ?? "",
      },
      pipelineId,
      parsed.data,
    );
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: err.code, details: err.details };
    return { ok: false, error: err instanceof Error ? err.message : "internal_error" };
  }

  revalidatePath("/app/settings/tenant/pipelines");
  return { ok: true };
}
