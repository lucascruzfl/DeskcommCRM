import { describe, expect, it, vi } from "vitest";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";
import { buildManagedAreaPolicy } from "@/lib/managed-clients/policy";

const mocks = vi.hoisted(() => ({ pathname: "", role: "agent" as "agent" | "admin" }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => mocks.pathname }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/lib/auth/server", () => ({
  requireAuth: async () => ({ id: "user" }),
  resolveActiveOrg: async () => ({
    orgId: "tenant", role: mocks.role,
    managed_policy: buildManagedAreaPolicy("managed/aesthetic-clinic"),
  }),
}));

import ManagedAreaGate from "./template";

const policy = buildManagedAreaPolicy("managed/aesthetic-clinic");

describe("URL direta de cliente gerenciado", () => {
  it.each(NAV_CATALOG.map(area => [area.href, policy.areas[area.href]] as const))(
    "%s respeita a classificação %s", async (href, classification) => {
      mocks.pathname = href;
      mocks.role = "agent";
      const page = ManagedAreaGate({ children: <span>página</span> });
      if (classification === "agency" || classification === "not_applicable") {
        await expect(page).rejects.toThrow("NEXT_NOT_FOUND");
      } else {
        await expect(page).resolves.toBeTruthy();
      }
    },
  );

  it("gestor com membership admin abre uma área da agência", async () => {
    mocks.pathname = "/app/ai/agents/123";
    mocks.role = "admin";
    await expect(ManagedAreaGate({ children: <span>página</span> })).resolves.toBeTruthy();
  });

  it.each(["/app/settings/canal-oficial", "/app/settings/templates"])(
    "nega URL legada de Conexões antes do redirect: %s", async (path) => {
      mocks.pathname = path;
      mocks.role = "agent";
      await expect(ManagedAreaGate({ children: <span>página</span> })).rejects.toThrow("NEXT_NOT_FOUND");
    },
  );

  it("sem contexto de rota falha fechado para política gerenciada", async () => {
    mocks.pathname = "";
    mocks.role = "agent";
    await expect(ManagedAreaGate({ children: <span>página</span> })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
