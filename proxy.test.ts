import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: {} }));
vi.mock("@/lib/auth/public-paths", () => ({ isPublicPath: () => true }));
vi.mock("next/server", () => ({
  NextResponse: {
    next: ({ request }: { request: { headers: Headers } }) => ({
      forwardedHeaders: new Headers(request.headers),
      headers: new Headers(),
    }),
  },
}));

import { proxy } from "./proxy";

describe("caminho confiável do proxy", () => {
  it("sobrescreve x-pathname fornecido pelo navegador antes de encaminhar", async () => {
    const request = {
      nextUrl: { pathname: "/app/ai/agents", search: "" },
      headers: new Headers({ "x-pathname": "/app/inbox" }),
    };
    const response = await proxy(request as never) as unknown as {
      forwardedHeaders: Headers;
      headers: Headers;
    };
    expect(response.forwardedHeaders.get("x-pathname")).toBe("/app/ai/agents");
    expect(response.headers.get("x-pathname")).toBe("/app/ai/agents");
  });
});
