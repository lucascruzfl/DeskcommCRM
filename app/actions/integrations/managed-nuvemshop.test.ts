import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gate: vi.fn(),
  getConfig: vi.fn(),
  admin: vi.fn(),
}));
vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: async () => ({ id: "manager", is_platform_admin: false, support: null }),
  resolveActiveOrg: async () => ({ orgId: "clinic", role: "admin" }),
}));
vi.mock("@/lib/impersonate/support", () => ({ supportWriteError: () => null }));
vi.mock("@/lib/managed-clients/server", () => ({ managedAreaAllowedForActor: mocks.gate }));
vi.mock("@/lib/nuvemshop/config", () => ({ getConfig: mocks.getConfig }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));

import { connectNuvemshop } from "./connectNuvemshop";
import { disconnectNuvemshop } from "./disconnectNuvemshop";

describe("actions da integração não aplicável", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.gate.mockResolvedValue(false);
  });

  it("nega conectar antes de emitir o estado OAuth", async () => {
    await expect(connectNuvemshop()).resolves.toEqual({ ok: false, error: "forbidden" });
    expect(mocks.gate).toHaveBeenCalledWith("clinic", "manager", "/app/integrations/nuvemshop");
    expect(mocks.getConfig).not.toHaveBeenCalled();
  });

  it("nega desconectar antes de usar service_role", async () => {
    await expect(disconnectNuvemshop()).resolves.toEqual({ ok: false, error: "forbidden" });
    expect(mocks.gate).toHaveBeenCalledWith("clinic", "manager", "/app/integrations/nuvemshop");
    expect(mocks.admin).not.toHaveBeenCalled();
  });
});
