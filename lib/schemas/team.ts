/**
 * EPIC-09 Team & Permissions — Zod schemas for invite, accept, role change, and api token.
 *
 * Roles are stored as `text` with a check constraint (not enum) on
 * `user_organizations.role` per project doctrine — keep this list in sync
 * with the DB constraint when adding/removing roles.
 */
import { z } from "zod";
import { interfaceSettingsSchema, interfaceTemDestino } from "@/lib/navigation/interface";
import {
  MCP_PUBLIC_CAPABILITIES,
  MCP_PUBLIC_TOOL_NAMES,
} from "@/lib/mcp/public-profile";

export const ROLES = ["viewer", "agent", "manager", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const inviteMemberSchema = z.object({
  invitations: z
    .array(
      z
        .object({
          email: z.string().email(),
          role: z.enum(ROLES),
          interface_settings: interfaceSettingsSchema.optional(),
        })
        .refine((v) => !v.interface_settings || interfaceTemDestino(v.interface_settings, v.role), {
          message: "Selecione ao menos uma área permitida ao papel.",
          path: ["interface_settings"],
        }),
    )
    .min(1)
    .max(20),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().min(20),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const changeRoleSchema = z.object({
  role: z.enum(ROLES),
});
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;

export const createApiTokenSchema = z
  .object({
    name: z.string().min(2).max(100),
    scopes: z.array(z.string()).default([]),
    expires_in_days: z.coerce.number().int().min(1).max(365).optional(),
    /** Presenca deste campo cria um token MCP publico, fechado por allowlist. */
    allowed_tools: z
      .array(z.string().refine((name) => MCP_PUBLIC_TOOL_NAMES.includes(name), "Tool não pública."))
      .min(1)
      .max(MCP_PUBLIC_TOOL_NAMES.length)
      .optional(),
    capabilities: z.array(z.enum(MCP_PUBLIC_CAPABILITIES)).max(2).optional(),
  })
  .refine((value) => value.scopes.length > 0 || Boolean(value.allowed_tools?.length), {
    message: "Selecione ao menos um escopo ou uma tool pública.",
    path: ["scopes"],
  });
export type CreateApiTokenInput = z.infer<typeof createApiTokenSchema>;
