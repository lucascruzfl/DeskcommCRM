import "server-only";

import type { Role } from "@/lib/auth/types";
import type { NavDestinationId } from "@/lib/navigation/catalogo";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAccessManagedArea, type ManagedAreaPolicy } from "./policy";

/**
 * Gate for server actions and callbacks that use service_role and cannot rely
 * on the caller's PostgREST RLS. The actor must have a current, accepted
 * membership in a managed tenant; legacy tenants retain their existing gates.
 */
export async function managedAreaAllowedForActor(
  organizationId: string,
  actorId: string | null | undefined,
  area: NavDestinationId,
): Promise<boolean> {
  const admin = createAdminClient();
  const { data: policy, error: policyError } = await admin
    .from("managed_client_policies")
    .select("business_type, management_mode, preset_id, preset_version, areas, overrides")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (policyError) return false;
  if (!policy) return true;
  if (!actorId) return false;

  const { data: membership, error: memberError } = await admin
    .from("user_organizations")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", actorId)
    .is("revoked_at", null)
    .not("accepted_at", "is", null)
    .maybeSingle();
  if (memberError || !membership) return false;
  return canAccessManagedArea(policy as ManagedAreaPolicy, membership.role as Role, area);
}
