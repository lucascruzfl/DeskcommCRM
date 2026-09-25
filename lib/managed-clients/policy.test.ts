import { describe, expect, it } from "vitest";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";
import { buildManagedAreaPolicy, canAccessManagedArea, managedAreaForPath } from "./policy";

describe("política canônica das 54 áreas", () => {
  const policy = buildManagedAreaPolicy("managed/aesthetic-clinic");

  it("o snapshot contém exatamente os 54 destinos do CRM", () => {
    expect(NAV_CATALOG).toHaveLength(54);
    expect(Object.keys(policy.areas).sort()).toEqual(NAV_CATALOG.map(area => area.href).sort());
  });

  it.each(NAV_CATALOG.map((area) => [area.href, policy.areas[area.href]] as const))(
    "%s tem a decisão de cliente e gestor da própria classificação (%s)",
    (href, classification) => {
      expect(canAccessManagedArea(policy, "agent", href)).toBe(
        classification === "client" || classification === "shared",
      );
      expect(canAccessManagedArea(policy, "admin", href)).toBe(classification !== "not_applicable");
    },
  );

  it("override muda a mesma decisão sem alterar o preset versionado", () => {
    const changed = buildManagedAreaPolicy("managed/aesthetic-clinic", [
      { href: "/app/campaigns", classification: "client" },
    ]);
    expect(canAccessManagedArea(policy, "agent", "/app/campaigns")).toBe(false);
    expect(canAccessManagedArea(changed, "agent", "/app/campaigns")).toBe(true);
    expect(policy.areas["/app/campaigns"]).toBe("agency");
    expect(changed.overrides).toEqual({ "/app/campaigns": "client" });
  });

  it("nega política incompleta e resolve subrota pela área mais específica", () => {
    expect(managedAreaForPath("/app/ai/cases/avisos/123")).toBe("/app/ai/cases/avisos");
    expect(managedAreaForPath("/app/ai/cases/123")).toBe("/app/ai/cases");
    const incomplete = { ...policy, areas: { ...policy.areas } };
    delete (incomplete.areas as Partial<typeof incomplete.areas>)["/app/campaigns"];
    expect(canAccessManagedArea(incomplete, "agent", "/app/campaigns")).toBe(false);
  });

  it("não atribui preset aos tenants antigos", () => {
    expect(canAccessManagedArea(null, "agent", "/app/ai/agents")).toBe(true);
  });
});
