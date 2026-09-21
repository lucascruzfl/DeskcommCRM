import { z } from "zod";

import { McpToolError } from "@/lib/mcp/errors";
import { humanAction } from "@/lib/mcp/human-action";
import {
  interfaceSettingsSchema,
  interfaceTemDestino,
  type InterfaceSettings,
} from "@/lib/navigation/interface";
import type { Role } from "@/lib/auth/types";
import { emitirConvite, reenviarConvite, type ConviteDeTime } from "@/lib/team/convites";
import type { McpContext, McpToolDefinition } from "@/lib/mcp/types";

const uuid = z.string().uuid();
const papelDelegavel = z.enum(["viewer", "agent", "manager"]);
const MEMBER_COLUMNS =
  "id, user_id, role, interface_settings, invited_at, accepted_at, revoked_at, created_at, updated_at";
const INVITE_COLUMNS =
  "id, organization_id, email, role, interface_settings, invited_by, inviter_name, email_dispatched, created_at, last_sent_at, resend_count, expires_at, accepted_at, revoked_at";

function falhar(
  code: ConstructorParameters<typeof McpToolError>[0],
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new McpToolError(code, message, details);
}
async function membro(ctx: McpContext, userId: string) {
  const { data, error } = await ctx.supabase
    .from("user_organizations")
    .select(MEMBER_COLUMNS)
    .eq("organization_id", ctx.organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) falhar("not_allowed", "team_member_read_failed");
  if (!data) falhar("not_found", "Membro não encontrado.");
  return data;
}
async function atorAdministrador(ctx: McpContext) {
  if (!ctx.provisionedByUserId)
    falhar(
      "human_action_required",
      "Ação de equipe exige token provisionado por um administrador humano.",
      humanAction({
        code: "team_admin_provisioner_required",
        reason: "team_administration_requires_active_human_admin",
        resource: { type: "team_membership" },
        instruction: "Peça a uma pessoa administradora para concluir a ação na tela de Equipe.",
        href: "/app/team",
      }),
    );
  const { data: membership } = await ctx.supabase
    .from("user_organizations")
    .select("id")
    .eq("organization_id", ctx.organizationId)
    .eq("user_id", ctx.provisionedByUserId!)
    .eq("role", "admin")
    .is("revoked_at", null)
    .not("accepted_at", "is", null)
    .maybeSingle();
  if (!membership)
    falhar(
      "human_action_required",
      "Administração da equipe exige um token provisionado por administrador ativo.",
      humanAction({
        code: "team_admin_provisioner_inactive",
        reason: "team_administration_requires_active_human_admin",
        resource: { type: "team_membership" },
        instruction:
          "Peça a uma pessoa administradora ativa para concluir a ação na tela de Equipe.",
        href: "/app/team",
      }),
    );
  const { data: user } = await ctx.supabase.auth.admin.getUserById(ctx.provisionedByUserId!);
  return {
    id: ctx.provisionedByUserId!,
    name: user?.user?.user_metadata?.full_name ?? user?.user?.email ?? "Administrador",
  };
}

export const crmGetTeamMember: McpToolDefinition<{ member_id: typeof uuid }> = {
  name: "crm_get_team_member",
  description:
    "Consulta papel, disponibilidade operacional e estado de um membro sem expor e-mail ou dados de autenticação.",
  inputSchema: { member_id: uuid },
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "team",
  handler: async (i, c) => ({ membro: await membro(c, i.member_id) }),
};

export const crmListTeamInvites: McpToolDefinition<Record<never, never>> = {
  name: "crm_list_team_invites",
  description:
    "Lista convites da organização e seus estados; nunca retorna token ou URL de aceite.",
  inputSchema: {},
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "team",
  handler: async (_i, c) => {
    await atorAdministrador(c);
    const { data, error } = await c.supabase
      .from("team_invites")
      .select(INVITE_COLUMNS)
      .eq("organization_id", c.organizationId)
      .order("created_at", { ascending: false });
    if (error) falhar("not_allowed", "team_invites_read_failed");
    return { convites: data ?? [] };
  },
};

const inviteShape = {
  email: z.string().trim().email().max(320),
  role: papelDelegavel,
  interface_settings: interfaceSettingsSchema.optional(),
};
export const crmInviteTeamMember: McpToolDefinition<typeof inviteShape> = {
  name: "crm_invite_team_member",
  description:
    "Envia convite real por e-mail usando o serviço oficial. Só permite viewer, agent ou manager; nunca admin/owner.",
  inputSchema: inviteShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "team",
  auditResource: (_i, r) => ({
    type: "team_invite",
    id: (r as { convite?: { id?: string } })?.convite?.id,
  }),
  handler: async (i, c) => {
    if (i.interface_settings && !interfaceTemDestino(i.interface_settings, i.role))
      falhar("validation_error", "Selecione ao menos uma área permitida ao papel.");
    const actor = await atorAdministrador(c);
    const { data: org } = await c.supabase
      .from("organizations")
      .select("display_name")
      .eq("id", c.organizationId)
      .maybeSingle();
    const result = await emitirConvite(c.supabase, {
      organizationId: c.organizationId,
      orgName: org?.display_name ?? "Organização",
      email: i.email,
      role: i.role,
      inviterId: actor.id,
      inviterName: actor.name,
      requestId: c.requestId,
      interfaceSettings: i.interface_settings,
    });
    return {
      convite: {
        id: result.convite.id,
        email: result.convite.email,
        role: result.convite.role,
        expires_at: result.convite.expires_at,
        email_dispatched: result.email_dispatched,
        renovado: result.renovado,
        ...(result.email_error ? { email_error: result.email_error } : {}),
      },
    };
  },
};

const interfaceShape = { member_id: uuid, interface_settings: interfaceSettingsSchema };
export const crmUpdateTeamMemberInterface: McpToolDefinition<typeof interfaceShape> = {
  name: "crm_update_team_member_interface",
  description:
    "Atualiza as áreas operacionais exibidas a um membro ativo; isso não concede permissão nem muda seu papel.",
  inputSchema: interfaceShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "team",
  auditResource: (i) => ({ type: "membership", id: i.member_id }),
  handler: async (i, c) => {
    await atorAdministrador(c);
    const target = await membro(c, i.member_id);
    if (target.revoked_at || !target.accepted_at)
      falhar("conflict", "A interface só pode ser alterada para membro ativo.");
    if (!interfaceTemDestino(i.interface_settings, target.role as Role))
      falhar("validation_error", "Selecione ao menos uma área permitida ao papel.");
    const { data, error } = await c.supabase
      .from("user_organizations")
      .update({ interface_settings: i.interface_settings as InterfaceSettings })
      .eq("organization_id", c.organizationId)
      .eq("user_id", i.member_id)
      .eq("role", target.role)
      .is("revoked_at", null)
      .not("accepted_at", "is", null)
      .select("id, user_id, interface_settings")
      .maybeSingle();
    if (error) falhar("not_allowed", "Não foi possível salvar a interface do membro.");
    if (!data) falhar("conflict", "O vínculo mudou. Consulte o membro e tente novamente.");
    return { membro: data };
  },
};

async function convite(ctx: McpContext, id: string) {
  const { data, error } = await ctx.supabase
    .from("team_invites")
    .select(INVITE_COLUMNS)
    .eq("organization_id", ctx.organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error) falhar("not_allowed", "team_invite_read_failed");
  if (!data) falhar("not_found", "Convite não encontrado.");
  return data as ConviteDeTime;
}

export const crmResendTeamInvite: McpToolDefinition<{ invite_id: typeof uuid }> = {
  name: "crm_resend_team_invite",
  description:
    "Reenvia um convite pendente pelo serviço oficial; não retorna o token ou a URL assinada.",
  inputSchema: { invite_id: uuid },
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "team",
  auditResource: (i) => ({ type: "team_invite", id: i.invite_id }),
  handler: async (i, c) => {
    const row = await convite(c, i.invite_id);
    if (row.accepted_at || row.revoked_at) falhar("conflict", "O convite não está pendente.");
    const actor = await atorAdministrador(c);
    const { data: org } = await c.supabase
      .from("organizations")
      .select("display_name")
      .eq("id", c.organizationId)
      .maybeSingle();
    const result = await reenviarConvite(c.supabase, {
      convite: row,
      orgName: org?.display_name ?? "Organização",
      actorId: actor.id,
      actorName: actor.name,
      requestId: c.requestId,
    });
    if (!result) falhar("conflict", "O convite deixou de estar pendente.");
    return {
      convite: {
        id: result.convite.id,
        email: result.convite.email,
        role: result.convite.role,
        expires_at: result.convite.expires_at,
        email_dispatched: result.email_dispatched,
        resend_count: result.convite.resend_count,
        ...(result.email_error ? { email_error: result.email_error } : {}),
      },
    };
  },
};

export const crmRevokeTeamInvite: McpToolDefinition<{ invite_id: typeof uuid }> = {
  name: "crm_revoke_team_invite",
  description: "Revoga convite pendente; o link já emitido deixa de conceder acesso.",
  inputSchema: { invite_id: uuid },
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "team",
  capabilities: ["destructive_operations"],
  auditResource: (i) => ({ type: "team_invite", id: i.invite_id }),
  handler: async (i, c) => {
    await atorAdministrador(c);
    const row = await convite(c, i.invite_id);
    if (row.accepted_at) falhar("conflict", "Convite já aceito não pode ser revogado.");
    if (row.revoked_at) return { invite_id: i.invite_id, already_revoked: true };
    const { error } = await c.supabase
      .from("team_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("organization_id", c.organizationId)
      .eq("id", i.invite_id)
      .is("accepted_at", null);
    if (error) falhar("not_allowed", "Não foi possível revogar o convite.");
    return { invite_id: i.invite_id, revoked: true };
  },
};

const roleShape = { member_id: uuid, role: papelDelegavel };
export const crmUpdateTeamMemberRole: McpToolDefinition<typeof roleShape> = {
  name: "crm_update_team_member_role",
  description:
    "Altera papel somente entre viewer, agent e manager. Autoelevação e qualquer alteração de admin/owner são recusadas.",
  inputSchema: roleShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "team",
  auditResource: (i) => ({ type: "membership", id: i.member_id }),
  handler: async (i, c) => {
    await atorAdministrador(c);
    if (i.member_id === c.provisionedByUserId)
      falhar("not_allowed", "O token não pode alterar o papel de quem o provisionou.");
    const target = await membro(c, i.member_id);
    if (target.role === "admin")
      falhar(
        "human_action_required",
        "Alterações de administrador devem ser feitas por uma pessoa na tela de Equipe.",
        humanAction({
          code: "admin_role_change_requires_human",
          reason: "privileged_role_change_requires_human",
          resource: { type: "team_membership", id: i.member_id },
          instruction: "Abra Equipe com uma sessão administradora e revise a alteração de papel.",
          href: "/app/team",
        }),
      );
    if (target.revoked_at) falhar("conflict", "Membro revogado precisa ser reativado antes.");
    const { error } = await c.supabase
      .from("user_organizations")
      .update({ role: i.role, updated_at: new Date().toISOString() })
      .eq("organization_id", c.organizationId)
      .eq("user_id", i.member_id)
      .neq("role", "admin");
    if (error) falhar("not_allowed", "Não foi possível alterar o papel.");
    return { member_id: i.member_id, role: i.role };
  },
};

export const crmRevokeTeamMember: McpToolDefinition<{ member_id: typeof uuid }> = {
  name: "crm_revoke_team_member",
  description:
    "Revoga um membro não administrador. Nunca revoga o provisionador do próprio token nem o último owner/admin.",
  inputSchema: { member_id: uuid },
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "team",
  capabilities: ["destructive_operations"],
  auditResource: (i) => ({ type: "membership", id: i.member_id }),
  handler: async (i, c) => {
    await atorAdministrador(c);
    if (i.member_id === c.provisionedByUserId)
      falhar("not_allowed", "O token não pode revogar quem o provisionou.");
    const target = await membro(c, i.member_id);
    if (target.role === "admin")
      falhar(
        "human_action_required",
        "Revogação de administrador exige ação humana na tela.",
        humanAction({
          code: "admin_revocation_requires_human",
          reason: "privileged_access_revocation_requires_human",
          resource: { type: "team_membership", id: i.member_id },
          instruction: "Abra Equipe com uma sessão administradora e confirme a revogação.",
          href: "/app/team",
        }),
      );
    if (target.revoked_at) return { member_id: i.member_id, already_revoked: true };
    const now = new Date().toISOString();
    const { error } = await c.supabase
      .from("user_organizations")
      .update({ revoked_at: now, updated_at: now })
      .eq("organization_id", c.organizationId)
      .eq("user_id", i.member_id)
      .neq("role", "admin");
    if (error) falhar("not_allowed", "Não foi possível revogar o membro.");
    return { member_id: i.member_id, revoked_at: now };
  },
};

export const crmReactivateTeamMember: McpToolDefinition<{ member_id: typeof uuid }> = {
  name: "crm_reactivate_team_member",
  description:
    "Reativa membro não administrador preservando o papel anterior; reativar nunca promove.",
  inputSchema: { member_id: uuid },
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "team",
  auditResource: (i) => ({ type: "membership", id: i.member_id }),
  handler: async (i, c) => {
    await atorAdministrador(c);
    const target = await membro(c, i.member_id);
    if (target.role === "admin")
      falhar(
        "human_action_required",
        "Reativação de administrador exige ação humana na tela.",
        humanAction({
          code: "admin_reactivation_requires_human",
          reason: "privileged_access_reactivation_requires_human",
          resource: { type: "team_membership", id: i.member_id },
          instruction: "Abra Equipe com uma sessão administradora e confirme a reativação.",
          href: "/app/team",
        }),
      );
    if (!target.revoked_at) return { member_id: i.member_id, already_active: true };
    const { error } = await c.supabase
      .from("user_organizations")
      .update({ revoked_at: null, updated_at: new Date().toISOString() })
      .eq("organization_id", c.organizationId)
      .eq("user_id", i.member_id)
      .neq("role", "admin");
    if (error) falhar("not_allowed", "Não foi possível reativar o membro.");
    return { member_id: i.member_id, reactivated: true, role: target.role };
  },
};

export const EQUIPE_ADMIN_MCP_TOOLS = [
  crmGetTeamMember,
  crmListTeamInvites,
  crmInviteTeamMember,
  crmResendTeamInvite,
  crmRevokeTeamInvite,
  crmUpdateTeamMemberInterface,
  crmUpdateTeamMemberRole,
  crmRevokeTeamMember,
  crmReactivateTeamMember,
] as const;
