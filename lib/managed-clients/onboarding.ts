import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailConfigurado } from "@/lib/email/roteador";
import { issueInvite } from "@/lib/auth/issue-invite";
import { audit } from "@/lib/audit";
import { buildManagedAreaPolicy } from "./policy";
import { MANAGED_CLIENT_PRESETS, MANAGED_PRESET_IDS, managedPresetAreas } from "./presets";

export const managedOnboardingSchema = z.object({
  organization_name: z.string().trim().min(2).max(120),
  preset: z.enum(MANAGED_PRESET_IDS),
  client_email: z.email().transform((email) => email.trim().toLowerCase()),
  slug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/).optional(),
  idempotency_key: z.uuid().optional(),
}).strict();

export type ManagedOnboardingInput = z.input<typeof managedOnboardingSchema>;
export interface ManagedOnboardingActor {
  userId: string | null;
  sourceOrganizationId?: string | null;
  apiTokenId?: string | null;
  requestId: string;
}

type InviteIssuer = typeof issueInvite;
type AuditWriter = typeof audit;
interface Dependencies {
  admin: () => SupabaseClient;
  emailConfigured: () => Promise<boolean>;
  issueInvite: InviteIssuer;
  audit: AuditWriter;
}

const defaults: Dependencies = {
  admin: createAdminClient,
  emailConfigured: emailConfigurado,
  issueInvite,
  audit,
};

function slugFrom(name: string): string {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

function stableUuid(hash: string): string {
  const chars = hash.slice(0, 32).split("");
  chars[12] = "4";
  chars[16] = ((parseInt(chars[16]!, 16) & 3) | 8).toString(16);
  const h = chars.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function sanitizedFailure(code: string): Error {
  // Não propagar erro SQL, URL de convite ou conteúdo do provedor para o MCP.
  return new Error(code);
}

interface Receipt {
  organization_id: string;
  actor_user_id: string;
  idempotency_key: string;
  request_hash: string;
  invite_id: string;
  state: "organization_created" | "inviting" | "failed" | "completed";
  email_dispatched: boolean;
}

/** Serviço canônico reutilizável por MCP e, futuramente, UI/admin. */
export function createManagedOnboardingService(deps: Dependencies = defaults) {
  async function plan(raw: ManagedOnboardingInput, actor: ManagedOnboardingActor) {
    const input = managedOnboardingSchema.parse(raw);
    const db = deps.admin();
    const preset = MANAGED_CLIENT_PRESETS[input.preset];
    const slug = input.slug ?? slugFrom(input.organization_name);
    const conflicts: string[] = [];
    const warnings: string[] = [];
    if (slug.length < 2) conflicts.push("invalid_slug");

    let actorEmail: string | null = null;
    let authorized = false;
    if (actor.userId && z.uuid().safeParse(actor.userId).success) {
      const { data: adminRow, error: adminError } = await db.from("platform_admins")
        .select("scope, mfa_required")
        .eq("user_id", actor.userId).is("revoked_at", null).maybeSingle();
      if (adminError) conflicts.push("authorization_unavailable");
      else if (adminRow?.scope === "full") {
        // Bearer token não traz prova AAL2. Se a política a exige, falha fechado.
        if (adminRow.mfa_required) conflicts.push("mfa_session_required");
        else {
          const sourceOrg = actor.sourceOrganizationId;
          if (sourceOrg) {
            const { data: member, error: memberError } = await db.from("user_organizations")
              .select("role")
              .eq("organization_id", sourceOrg).eq("user_id", actor.userId)
              .is("revoked_at", null).not("accepted_at", "is", null).maybeSingle();
            if (memberError) conflicts.push("agency_membership_unavailable");
            else if (!member || !["admin", "manager"].includes(member.role))
              conflicts.push("agency_membership_required");
            else authorized = true;
          } else authorized = true;
        }
      } else conflicts.push("platform_admin_full_required");
      if (authorized) {
        const { data, error } = await db.auth.admin.getUserById(actor.userId);
        if (error || !data.user?.email) conflicts.push("actor_email_unavailable");
        else actorEmail = data.user.email.trim().toLowerCase();
      }
    } else conflicts.push("authenticated_actor_required");
    if (actorEmail === input.client_email) conflicts.push("client_is_agency_manager");

    const identity = {
      actor: actor.userId,
      organization_name: input.organization_name,
      slug,
      client_email: input.client_email,
      preset: input.preset,
    };
    const requestHash = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
    const key = input.idempotency_key ?? stableUuid(requestHash);
    let receipt: Receipt | null = null;
    if (authorized && actor.userId) {
      const { data, error } = await db.from("managed_client_onboardings")
        .select("organization_id,actor_user_id,idempotency_key,request_hash,invite_id,state,email_dispatched")
        .eq("actor_user_id", actor.userId).eq("idempotency_key", key).maybeSingle();
      if (error) conflicts.push("onboarding_service_unavailable");
      else receipt = data as Receipt | null;
      if (receipt && receipt.request_hash !== requestHash) conflicts.push("idempotency_key_conflict");
      if (!receipt && slug.length >= 2) {
        const { data: existingOrg, error: slugError } = await db.from("organizations")
          .select("id").eq("slug", slug).maybeSingle();
        if (slugError) conflicts.push("organization_lookup_unavailable");
        else if (existingOrg) conflicts.push("organization_slug_exists");
      }
    }
    let mailAvailable = false;
    try { mailAvailable = await deps.emailConfigured(); }
    catch { conflicts.push("invitation_service_unavailable"); }
    if (!mailAvailable) warnings.push("email_delivery_not_configured");
    const areas = managedPresetAreas(input.preset);
    const canExecute = authorized && !!actorEmail && conflicts.length === 0 &&
      (mailAvailable || receipt?.state === "completed");
    return {
      plan_id: requestHash,
      organization_name: input.organization_name,
      slug,
      preset: { id: preset.id, version: preset.version, label: preset.label },
      client: { email: input.client_email, role: "agent" as const },
      agency_membership: { user_id: actor.userId, role: "admin" as const, source: "official_membership" },
      client_areas: areas.filter((area) => area.classification === "client"),
      agency_areas: areas.filter((area) => area.classification === "agency"),
      shared_areas: areas.filter((area) => area.classification === "shared"),
      not_applicable_areas: areas.filter((area) => area.classification === "not_applicable"),
      warnings, conflicts,
      idempotency: receipt ? { status: receipt.state, organization_id: receipt.organization_id } : { status: "new", organization_id: null },
      idempotency_key: key,
      can_execute: canExecute,
      requires_confirmation: true as const,
      // Campos internos nunca saem da tool; execute recompõe o plano.
      _internal: { actorEmail, requestHash, receipt },
    };
  }

  async function preflight(raw: ManagedOnboardingInput, actor: ManagedOnboardingActor) {
    const { _internal: _ignored, ...visible } = await plan(raw, actor);
    return visible;
  }

  async function execute(raw: ManagedOnboardingInput, actor: ManagedOnboardingActor, confirm: boolean) {
    const planned = await plan(raw, actor);
    const { _internal, ...preflightResult } = planned;
    if (!confirm) return preflightResult;
    if (!planned.can_execute || !actor.userId || !_internal.actorEmail) {
      throw sanitizedFailure("managed_onboarding_denied");
    }
    const db = deps.admin();
    const input = managedOnboardingSchema.parse(raw);
    if (_internal.receipt?.state === "completed") {
      return { status: "already_completed", organization_id: _internal.receipt.organization_id,
        invite_id: _internal.receipt.invite_id, client_role: "agent", email_dispatched: _internal.receipt.email_dispatched };
    }
    const request = {
      display_name: input.organization_name,
      slug: planned.slug,
      legal_name: input.organization_name,
      plan: "standard",
      owner_email: _internal.actorEmail,
    };
    const policy = buildManagedAreaPolicy(input.preset);
    const { data: started, error: beginError } = await db.rpc("fn_begin_managed_client_onboarding", {
      p_actor: actor.userId, p_key: planned.idempotency_key, p_request: request,
      p_hash: _internal.requestHash, p_client_email: input.client_email, p_policy: policy,
    });
    if (beginError || !started?.organization_id || !started?.invite_id) {
      throw sanitizedFailure(beginError?.code === "23505" || beginError?.code === "22023"
        ? "managed_onboarding_conflict" : "managed_onboarding_unavailable");
    }
    const organizationId = String(started.organization_id);
    const inviteId = String(started.invite_id);
    if (started.created) await deps.audit({
      action: "managed_client.onboarding_started", actorUserId: actor.userId,
      actorApiTokenId: actor.apiTokenId, actingAsPlatformAdmin: true, bypassedRls: true,
      organizationId, resourceType: "organization", resourceId: organizationId,
      requestId: actor.requestId,
      metadata: { idempotency_key: planned.idempotency_key, preset: input.preset,
        agency_membership_role: "admin", client_role: "agent", invite_id: inviteId, state: "organization_created" },
    });
    const claimId = randomUUID();
    const { data: claim, error: claimError } = await db.rpc("fn_claim_managed_client_invite", {
      p_actor: actor.userId, p_key: planned.idempotency_key, p_claim: claimId,
    });
    if (claimError) throw sanitizedFailure("managed_invite_claim_failed");
    if (!claim?.claimed) {
      return { status: claim?.state === "completed" ? "already_completed" : "in_progress",
        organization_id: organizationId, invite_id: inviteId, client_role: "agent" };
    }
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = new Date((issuedAt + 86400) * 1000).toISOString();
    const { data: renewed, error: renewalError } = await db.from("team_invites")
      .update({ last_sent_at: new Date(issuedAt * 1000).toISOString(), expires_at: expiresAt })
      .eq("organization_id", organizationId).eq("id", inviteId)
      .is("accepted_at", null).is("revoked_at", null).select("id").maybeSingle();
    if (renewalError || !renewed) throw sanitizedFailure("managed_invite_prepare_failed");
    let dispatched = false;
    let errorCode: string | null = null;
    try {
      const invited = await deps.issueInvite({
        email: input.client_email, role: "agent", organizationId,
        orgName: input.organization_name, inviterId: actor.userId,
        inviterName: _internal.actorEmail, requestId: actor.requestId,
        inviteId, issuedAt,
      });
      dispatched = invited.email_dispatched;
      if (!dispatched) errorCode = invited.email_error ?? "email_not_dispatched";
    } catch { errorCode = "email_send_failed"; }
    const state = dispatched ? "completed" : "failed";
    const { data: inviteUpdated, error: inviteUpdateError } = await db.from("team_invites")
      .update({ email_dispatched: dispatched })
      .eq("organization_id", organizationId).eq("id", inviteId).select("id").maybeSingle();
    const { data: closed, error: stateError } = await db.from("managed_client_onboardings")
      .update({ state, email_dispatched: dispatched, last_error_code: errorCode,
        claim_id: null, updated_at: new Date().toISOString(),
        completed_at: dispatched ? new Date().toISOString() : null })
      .eq("organization_id", organizationId).eq("actor_user_id", actor.userId)
      .eq("idempotency_key", planned.idempotency_key).eq("claim_id", claimId)
      .select("organization_id").maybeSingle();
    if (inviteUpdateError || !inviteUpdated || stateError || !closed)
      throw sanitizedFailure("managed_onboarding_state_failed");
    await deps.audit({
      action: dispatched ? "managed_client.onboarding_completed" : "managed_client.onboarding_failed",
      actorUserId: actor.userId, actorApiTokenId: actor.apiTokenId,
      actingAsPlatformAdmin: true, bypassedRls: true, organizationId,
      resourceType: "organization", resourceId: organizationId, requestId: actor.requestId,
      metadata: { idempotency_key: planned.idempotency_key, preset: input.preset,
        invite_id: inviteId, state, error_code: errorCode },
    });
    return { status: state, organization_id: organizationId, invite_id: inviteId,
      client_role: "agent", agency_role: "admin", email_dispatched: dispatched,
      retryable: !dispatched };
  }

  return { preflight, execute };
}

export const managedOnboardingService = createManagedOnboardingService();
