/**
 * GET /api/v1/voice/sessions/status — estado do pareamento de chamada de voz
 * da organização ativa. Usado pelo discador (§5.1 da spec) pra decidir se
 * mostra o botão "Ligar".
 */
import { randomUUID } from "node:crypto";

import { ok } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();

  const user = await loadAuthUser();
  if (!user) return new Response(null, { status: 401 });
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return new Response(null, { status: 403 });

  const { data } = await createAdminClient()
    .from("channel_sessions")
    .select("id, status, wacalls_paired_at")
    .eq("organization_id", activeOrg.orgId)
    .eq("provider", "wacalls")
    .is("archived_at", null)
    .maybeSingle();

  const row = data as {
    id: string;
    status: string;
    wacalls_paired_at: string | null;
  } | null;

  return ok(
    {
      configured: !!row,
      channelSessionId: row?.id ?? null,
      status: row?.status ?? null,
      paired: !!row?.wacalls_paired_at,
    },
    { requestId },
  );
}
