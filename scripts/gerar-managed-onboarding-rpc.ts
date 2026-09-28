import { readFileSync } from "node:fs";
import { MANAGED_CLIENT_PRESETS } from "../lib/managed-clients/presets";

/** Snapshot SQL derivado do registro TS. Sempre publicar em uma NOVA migration. */
export function managedOnboardingRpcSql(): string {
  // Template imutável da Fase 6: só a seleção do preset muda.
  const template = readFileSync(
    "supabase/migrations/20260927201516_0474_onboarding_cliente_gerenciado.sql",
    "utf8",
  );
  const start = template.indexOf(
    "create or replace function public.fn_begin_managed_client_onboarding(",
  );
  const end = template.indexOf("create or replace function public.fn_claim_managed_client_invite(");
  const original = template.slice(start, end);
  const guardStart = original.indexOf("     or p_policy->>'preset_id'");
  const guardEnd = original.indexOf("     or jsonb_typeof(p_policy->'areas')");
  if (start < 0 || end <= start || guardStart < 0 || guardEnd <= guardStart)
    throw new Error("managed_rpc_template_changed");
  const previous = original.slice(guardStart, guardEnd).trimEnd();
  const snapshot = JSON.stringify(
    Object.values(MANAGED_CLIENT_PRESETS).map((preset) => ({
      id: preset.id,
      business_type: preset.business_type,
      management_mode: preset.management_mode,
    })),
  );
  const guard = `     or not exists (
       -- Snapshot gerado de MANAGED_CLIENT_PRESETS; não manter lista SQL à mão.
       select 1 from jsonb_to_recordset('${snapshot.replaceAll("'", "''")}'::jsonb)
         as registered(id text, business_type text, management_mode text)
       where registered.id = p_policy->>'preset_id'
         and registered.business_type = p_policy->>'business_type'
         and registered.management_mode = p_policy->>'management_mode'
     )`;
  return (
    "-- Presets oficiais do onboarding gerenciado. Gerado por:\n" +
    "-- pnpm exec tsx scripts/gerar-managed-onboarding-rpc.ts\n" +
    "-- Sem backfill: políticas já persistidas permanecem intactas.\n" +
    original.replace(previous, guard) +
    "notify pgrst, 'reload schema';\n"
  );
}

if (process.argv[1]?.endsWith("gerar-managed-onboarding-rpc.ts")) {
  process.stdout.write(managedOnboardingRpcSql());
}
