import { describe, expect, it } from "vitest";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";
import { MANAGED_CLIENT_PRESETS, managedPresetAreas } from "./presets";
import { preflightManagedClient } from "./preflight";

const proposal = {
  business_type: "aesthetic_clinic" as const,
  management_mode: "managed" as const,
  name: "Clínica Vip",
  slug: "clinica-vip",
  client_email: "Contato@ClinicaVip.com.br",
};

describe("preset de clínica de estética gerenciada", () => {
  it("classifica cada porta real exatamente uma vez e mantém criação fechada", () => {
    const preset = MANAGED_CLIENT_PRESETS["managed/aesthetic-clinic"];
    const areas = managedPresetAreas(preset.id);
    expect(areas).toHaveLength(NAV_CATALOG.length);
    expect(new Set(areas.map((area) => area.href)).size).toBe(NAV_CATALOG.length);
    expect(areas.find((area) => area.href === "/app/inbox")?.classification).toBe("client");
    expect(areas.find((area) => area.href === "/app/ai/agents")?.classification).toBe("agency");
    expect(areas.find((area) => area.href === "/app/ai/cases")?.classification).toBe("shared");
    expect(preset.executable).toBe(false);
  });

  it("gera plano estável, mostra conflito crítico e não transforma override em autorização", () => {
    const input = { ...proposal, overrides: [{ href: "/app/campaigns" as const, classification: "client" as const }] };
    const first = preflightManagedClient(input, { proposed_manager_id: "manager-id" });
    const second = preflightManagedClient(input, { proposed_manager_id: "manager-id" });
    expect(first.plan_id).toBe(second.plan_id);
    expect(first.can_execute).toBe(false);
    expect(first.conflicts).toContain("overrides_not_enforced");
    expect(first.conflicts).toContain("technical_rls_read_exposure");
    expect(first.client_areas.some((area) => area.href === "/app/campaigns")).toBe(true);
    expect(first.client.email).toBe("contato@clinicavip.com.br");
    expect(first.human_actions).toContain("Confirmar o e-mail se a conta ainda não estiver verificada");
    expect(first.client_areas.length + first.agency_areas.length + first.shared_areas.length + first.not_applicable_areas.length)
      .toBe(NAV_CATALOG.length);
  });

  it("recusa tipo de negócio e área desconhecidos", () => {
    expect(() => preflightManagedClient({ ...proposal, business_type: "real_estate" as never }, {
      proposed_manager_id: null,
    })).toThrow();
    expect(() => preflightManagedClient({ ...proposal, overrides: [{ href: "/app/inventada" as never, classification: "client" }] }, {
      proposed_manager_id: null,
    })).toThrow();
  });
});
