import type { SupabaseClient } from "@supabase/supabase-js";
import { ARCHIVED_AT, queryTolerantToMissingArchived } from "@/lib/channels/archived";

export type RouterCreateError =
  | "channel_session_not_found"
  | "fallback_agent_not_found"
  | "router_already_exists"
  | "internal_error";

/** Shared by the REST editor and managed packages; never derives tenant from input. */
export async function createAiRouter(
  db: SupabaseClient,
  orgId: string,
  input: {
    id?: string;
    name: string;
    channel_session_id: string;
    fallback_agent_id?: string | null;
    config?: Record<string, unknown>;
    is_active?: boolean;
    created_by?: string | null;
  },
): Promise<{ ok: true; id: string } | { ok: false; error: RouterCreateError }> {
  const base = () =>
    db
      .from("channel_sessions")
      .select("id")
      .eq("id", input.channel_session_id)
      .eq("organization_id", orgId);
  const { data: session, error: sessionError } = await queryTolerantToMissingArchived(
    () => base().is(ARCHIVED_AT, null).maybeSingle(),
    () => base().maybeSingle(),
  );
  if (sessionError) return { ok: false, error: "internal_error" };
  if (!session) return { ok: false, error: "channel_session_not_found" };
  if (input.fallback_agent_id) {
    const { data: fallback, error: fallbackError } = await db
      .from("ai_agents")
      .select("id")
      .eq("organization_id", orgId)
      .eq("id", input.fallback_agent_id)
      .is("archived_at", null)
      .maybeSingle();
    if (fallbackError) return { ok: false, error: "internal_error" };
    if (!fallback) return { ok: false, error: "fallback_agent_not_found" };
  }
  const { data: created, error } = await db
    .from("ai_routers")
    .insert({
      ...(input.id ? { id: input.id } : {}),
      organization_id: orgId,
      name: input.name,
      channel_session_id: input.channel_session_id,
      fallback_agent_id: input.fallback_agent_id ?? null,
      ...(input.config !== undefined ? { config: input.config } : {}),
      ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
      created_by: input.created_by ?? null,
    })
    .select("id")
    .single();
  if (error?.code === "23505") return { ok: false, error: "router_already_exists" };
  if (error || !created) return { ok: false, error: "internal_error" };
  return { ok: true, id: created.id };
}
