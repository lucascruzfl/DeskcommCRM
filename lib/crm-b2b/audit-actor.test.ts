import { describe, expect, it } from "vitest";

import type { HandlerCtx } from "@/lib/api/handlers/types";
import { b2bAuditActor } from "./audit-actor";

const userId = "10000000-0000-4000-8000-000000000001";
const tokenId = "20000000-0000-4000-8000-000000000002";
const base = { organization_id: "30000000-0000-4000-8000-000000000003", requestId: "audit-test" };

describe("proveniência B2B", () => {
  it("autoria do registro permanece humana e a ação do token não se disfarça de humano", () => {
    const token = { ...base, actor: { type: "api_token", id: tokenId } } as HandlerCtx;
    expect(b2bAuditActor(token, userId)).toEqual({ actorUserId: null, actorApiTokenId: tokenId });
    const human = { ...base, actor: { type: "user", id: userId } } as HandlerCtx;
    expect(b2bAuditActor(human, userId)).toEqual({ actorUserId: userId });
  });
});
