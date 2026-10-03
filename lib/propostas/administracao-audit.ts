import type { HandlerCtx } from "@/lib/api/handlers/types";
/** A integração mantém identidade de token, nunca se passa por pessoa. */
export function proposalAuditActor(ctx: HandlerCtx) {
  return {
    actorUserId: ctx.actor.type === "user" ? ctx.actor.id : null,
    actorApiTokenId:
      ctx.actor.type === "api_token"
        ? ctx.actor.id
        : ctx.actor.type === "ai_agent"
          ? (ctx.actor.api_token_id ?? null)
          : null,
  };
}
