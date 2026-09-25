import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";
import { buildManagedAreaPolicy, canAccessManagedArea, managedAreaForPath, managedAreaForResource } from "./policy";

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
    expect(managedAreaForPath("/app/pipelines/123")).toBe("/app/kanban");
    expect(managedAreaForPath("/app/leads/123")).toBe("/app/kanban");
    expect(managedAreaForPath("/app/settings/canal-oficial")).toBe("/app/connections");
    expect(managedAreaForPath("/app/settings/templates")).toBe("/app/connections");
    const incomplete = { ...policy, areas: { ...policy.areas } };
    delete (incomplete.areas as Partial<typeof incomplete.areas>)["/app/campaigns"];
    expect(canAccessManagedArea(incomplete, "agent", "/app/campaigns")).toBe(false);
  });

  it("não atribui preset aos tenants antigos", () => {
    expect(canAccessManagedArea(null, "agent", "/app/ai/agents")).toBe(true);
  });

  it("separa leitura operacional de modelos da configuração de canais", () => {
    for (const resource of ["channel_templates_read", "channels_graph_partner_templates_read"]) {
      const area = managedAreaForResource(resource);
      expect(area).toBe("/app/inbox");
      expect(canAccessManagedArea(policy, "agent", area!)).toBe(true);
    }
    for (const resource of ["channel_templates", "channels_graph_partner_templates"]) {
      const area = managedAreaForResource(resource);
      expect(area).toBe("/app/connections");
      expect(canAccessManagedArea(policy, "agent", area!)).toBe(false);
    }
  });

  it("classifica toda página de área; hubs e manutenção têm autorização própria", () => {
    const pages = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
      .flatMap((entry) => entry.isDirectory()
        ? pages(join(directory, entry.name))
        : entry.name === "page.tsx" ? [join(directory, entry.name)] : []);
    const hubsAndPlatform = new Set(["/app", "/app/ai", "/app/analise", "/app/crm", "/app/settings", "/app/settings/atualizacao"]);
    const uncovered = pages("app/app")
      .map((page) => `/${dirname(page).replace(/^app\//, "")}`)
      .filter((route) => !route.includes("[") && !hubsAndPlatform.has(route) && !managedAreaForPath(route));
    expect(uncovered).toEqual([]);
  });
});
