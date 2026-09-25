import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { canAccessManagedArea, managedAreaForPath } from "@/lib/managed-clients/policy";

/** Re-evaluated on navigation, including direct URLs and nested area pages. */
export default async function ManagedAreaGate({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get("x-pathname") ?? "";
  const area = managedAreaForPath(pathname);
  if (area || !pathname) {
    const user = await requireAuth();
    const org = await resolveActiveOrg(user);
    if (!org || (!pathname && org.managed_policy) || (area && !canAccessManagedArea(org.managed_policy, org.role, area))) notFound();
  }
  return children;
}
