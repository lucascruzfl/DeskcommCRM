import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gate: vi.fn(),
  exchange: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "http://localhost:3000" } }));
vi.mock("@/lib/nuvemshop/config", () => ({ getConfig: () => ({ appId: "test" }), SUBSCRIBED_EVENTS: [], eventToSlug: () => "" }));
vi.mock("@/lib/nuvemshop/state", () => ({ verifyState: () => ({ orgId: "clinic", userId: "manager", authSessionId: "session" }) }));
vi.mock("@/lib/impersonate/support", () => ({ supportCallbackWriteAllowed: async () => true }));
vi.mock("@/lib/managed-clients/server", () => ({ managedAreaAllowedForActor: mocks.gate }));
vi.mock("@/lib/nuvemshop/oauth", () => ({ exchangeCodeForToken: mocks.exchange }));

import { GET } from "./route";

describe("callback OAuth de área não aplicável", () => {
  it("nega antes de trocar o código por token externo", async () => {
    mocks.gate.mockResolvedValue(false);
    const response = await GET(new Request("http://localhost:3000/api/v1/integrations/nuvemshop/callback?code=code&state=signed") as never);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("error=forbidden_area");
    expect(mocks.gate).toHaveBeenCalledWith("clinic", "manager", "/app/integrations/nuvemshop");
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
});
