import type { HandlerCtx } from "@/lib/api/handlers/types";

/** `created_by` usa o humano que provisionou o token; auditoria atribui a ação ao token. */
export function b2bAuditActor(ctx: HandlerCtx, actorUserId: string) {
  if (ctx.actor.type === "api_token") {
    return { actorUserId: null, actorApiTokenId: ctx.actor.id };
  }
  if (ctx.actor.type === "ai_agent") {
    return { actorUserId: null, actorApiTokenId: ctx.actor.api_token_id ?? null };
  }
  return { actorUserId: ctx.actor.type === "user" ? actorUserId : null };
}
