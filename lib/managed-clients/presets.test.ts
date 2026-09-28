import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";
import { managedOnboardingRpcSql } from "../../scripts/gerar-managed-onboarding-rpc";
import { MANAGED_CLIENT_PRESETS, managedPresetAreas } from "./presets";
import { preflightManagedClient } from "./preflight";

const isp = MANAGED_CLIENT_PRESETS["managed/internet-provider"];

describe("registro canônico de presets gerenciados", () => {
  it("IDs e tipos de negócio são únicos e cada chave corresponde ao ID", () => {
    const presets = Object.values(MANAGED_CLIENT_PRESETS);
    expect(new Set(presets.map((preset) => preset.business_type)).size).toBe(presets.length);
    for (const [key, preset] of Object.entries(MANAGED_CLIENT_PRESETS)) expect(preset.id).toBe(key);
  });

  it("ISP classifica todo o catálogo e não oferece agenda nem cobrança fictícia", () => {
    expect(isp).toMatchObject({
      id: "managed/internet-provider",
      version: "1.0.0",
      business_type: "internet_provider",
      label: "Provedor de internet — cliente gerenciado",
    });
    expect(Object.keys(isp.areas).sort()).toEqual(NAV_CATALOG.map((area) => area.href).sort());
    expect(managedPresetAreas(isp.id)).toHaveLength(NAV_CATALOG.length);
    expect(
      Object.entries(isp.areas)
        .filter(([, value]) => value === "not_applicable")
        .map(([href]) => href)
        .sort(),
    ).toEqual(
      [
        "/app/prospecting",
        "/app/agenda",
        "/app/settings/tenant/agenda",
        "/app/comandas",
        "/app/settings/tenant/financeiro",
        "/app/faturamento",
        "/app/integrations/nuvemshop",
        "/app/companies",
        "/app/people",
        "/app/imports",
        "/app/proposals",
        "/app/settings/tenant/proposals",
        "/app/settings/tenant/proposals/modelos",
        "/app/honorarios",
      ].sort(),
    );
    for (const href of [
      "/app/inbox",
      "/app/contacts",
      "/app/kanban",
      "/app/tasks",
      "/app/metrics",
      "/app/activities",
      "/app/settings/profile",
      "/app/settings/security",
      "/app/settings/notifications",
    ] as const)
      expect(isp.areas[href]).toBe("client");
    for (const href of [
      "/app/team",
      "/app/ai/cases",
      "/app/ai/inbox",
      "/app/lgpd/requests",
      "/app/products",
    ] as const)
      expect(isp.areas[href]).toBe("shared");
  });

  it("preflight puro resolve ISP e inclui o preset no hash", () => {
    const input = {
      name: "Cliente fixture",
      slug: "cliente-fixture",
      client_email: "fixture@test.invalid",
      management_mode: "managed" as const,
      business_type: isp.business_type,
    };
    const result = preflightManagedClient(input, { proposed_manager_id: null });
    expect(result.preset.id).toBe(isp.id);
    expect(result.not_applicable_areas.map((area) => area.href)).toContain("/app/agenda");
    expect(result.agency_areas.map((area) => area.href)).toContain("/app/ai/agents");
    expect(result.plan_id).toBe(
      preflightManagedClient(input, { proposed_manager_id: null }).plan_id,
    );
    expect(result.plan_id).not.toBe(
      preflightManagedClient(
        { ...input, business_type: "aesthetic_clinic" },
        { proposed_manager_id: null },
      ).plan_id,
    );
  });

  it("a última RPC da migration e do baseline contém o snapshot derivado, sem drift", () => {
    const signature = "create or replace function public.fn_begin_managed_client_onboarding(";
    const latestRpc = (text: string) => {
      const start = text.toLowerCase().lastIndexOf(signature);
      expect(start).toBeGreaterThanOrEqual(0);
      const end = text.indexOf("end $$;", start);
      return text.slice(start, end + "end $$;".length);
    };
    const migrations = readdirSync("supabase/migrations")
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .map((file) => readFileSync(`supabase/migrations/${file}`, "utf8"))
      .join("\n");
    const expected = latestRpc(managedOnboardingRpcSql());
    expect(latestRpc(migrations)).toBe(expected);
    expect(latestRpc(readFileSync("supabase/baseline.sql", "utf8"))).toBe(expected);
  });
});
