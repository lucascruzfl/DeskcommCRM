import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import ts from "typescript";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";
import {
  buildManagedAreaPolicy,
  canAccessManagedArea,
  managedAreaForPath,
  managedAreaForResource,
} from "./policy";

describe("política canônica das 54 áreas", () => {
  const policy = buildManagedAreaPolicy("managed/aesthetic-clinic");

  it("o snapshot contém exatamente os 54 destinos do CRM", () => {
    expect(NAV_CATALOG).toHaveLength(54);
    expect(Object.keys(policy.areas).sort()).toEqual(NAV_CATALOG.map((area) => area.href).sort());
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

  it("mantém a decisão do snapshot persistido após evolução da versão do código", () => {
    const previous = { ...policy, preset_version: "0.9.0" };
    expect(canAccessManagedArea(previous, "agent", "/app/inbox")).toBe(true);
    expect(canAccessManagedArea(previous, "agent", "/app/campaigns")).toBe(false);
  });

  it("nega política incompleta e resolve subrota pela área mais específica", () => {
    expect(managedAreaForPath("/app/ai/cases/avisos/123")).toBe("/app/ai/cases/avisos");
    expect(managedAreaForPath("/app/ai/cases/123")).toBe("/app/ai/cases");
    expect(managedAreaForPath("/onboarding/funil")).toBe("/app/settings/tenant");
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

  it("separa a listagem de funis da administração do funil", () => {
    expect(managedAreaForResource("pipelines")).toBe("/app/kanban");
    expect(managedAreaForResource("crm_pipelines")).toBe("/app/settings/tenant/pipelines");
    expect(canAccessManagedArea(policy, "agent", managedAreaForResource("pipelines")!)).toBe(true);
    expect(canAccessManagedArea(policy, "agent", managedAreaForResource("crm_pipelines")!)).toBe(
      false,
    );
  });

  it("separa o uso operacional de tags da administração do vocabulário", () => {
    expect(policy.areas["/app/settings/tags"]).toBe("agency");
    expect(canAccessManagedArea(policy, "agent", managedAreaForResource("conversations")!)).toBe(true);
    expect(canAccessManagedArea(policy, "agent", managedAreaForResource("settings_tags")!)).toBe(false);
  });

  it("classifica toda página de área; hubs e manutenção têm autorização própria", () => {
    const pages = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? pages(join(directory, entry.name))
          : entry.name === "page.tsx"
            ? [join(directory, entry.name)]
            : [],
      );
    const hubsAndPlatform = new Set([
      "/app",
      "/app/ai",
      "/app/analise",
      "/app/crm",
      "/app/settings",
      "/app/settings/atualizacao",
    ]);
    const uncovered = pages("app/app")
      .map((page) => `/${dirname(page).replace(/^app\//, "")}`)
      .filter(
        (route) =>
          !route.includes("[") && !hubsAndPlatform.has(route) && !managedAreaForPath(route),
      );
    expect(uncovered).toEqual([]);
  });

  it("mapeia cada resource explícito das rotas API para uma das 54 áreas", () => {
    const routes = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? routes(join(directory, entry.name))
          : entry.name === "route.ts"
            ? [join(directory, entry.name)]
            : [],
      );
    const resources = new Set(
      routes("app/api/v1").flatMap((file) =>
        Array.from(
          readFileSync(file, "utf8").matchAll(/resource:\s*["']([^"']+)["']/g),
          (match) => match[1],
        ),
      ),
    );
    expect(resources.size).toBeGreaterThan(80);
    expect([...resources].filter((resource) => !managedAreaForResource(resource))).toEqual([]);
  });

  it("não deixa requireRole sem recurso de área nas rotas do tenant", () => {
    const uncovered: string[] = [];
    for (const file of routesOfTenant("app/api/v1")) {
      const ast = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "requireRole"
        ) {
          const opts = node.arguments[1];
          const hasResource =
            opts &&
            ts.isObjectLiteralExpression(opts) &&
            opts.properties.some(
              (property) =>
                ts.isPropertyAssignment(property) &&
                ts.isIdentifier(property.name) &&
                property.name.text === "resource",
            );
          if (!hasResource) uncovered.push(file);
        }
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
    expect(uncovered).toEqual([]);
  });
});

function routesOfTenant(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? routesOfTenant(join(directory, entry.name))
      : entry.name === "route.ts"
        ? [join(directory, entry.name)]
        : [],
  );
}
