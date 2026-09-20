import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { roleAtLeast, type Role } from "@/lib/auth/types";
import { mencaoAtingeUsuario, tokensDeMencao } from "@/lib/notifications/mentions";

const COLUNAS = "id, conversation_id, body, created_by_user_id, created_by_name, created_at";

export async function listarNotasDaConversa(
  db: SupabaseClient,
  organizationId: string,
  conversationId: string,
) {
  const { data: conversation, error: conversationError } = await db
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (conversationError) throw new Error(conversationError.message);
  if (!conversation) throw new Error("conversation_not_found");

  const { data, error } = await db
    .from("conversation_notes")
    .select(COLUNAS)
    .eq("conversation_id", conversationId)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function criarNotaDaConversa(input: {
  db: SupabaseClient;
  organizationId: string;
  conversationId: string;
  body: string;
  authorUserId: string;
  authorName: string | null;
  apiTokenId?: string | null;
  requestId: string;
}) {
  const { data: member, error: memberError } = await input.db
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", input.organizationId)
    .eq("user_id", input.authorUserId)
    .is("revoked_at", null)
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  if (!member) throw new Error("author_not_active_member");

  const { data: conversation, error: conversationError } = await input.db
    .from("conversations")
    .select("id")
    .eq("id", input.conversationId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (conversationError) throw new Error(conversationError.message);
  if (!conversation) throw new Error("conversation_not_found");

  const { data, error } = await input.db
    .from("conversation_notes")
    .insert({
      organization_id: input.organizationId,
      conversation_id: input.conversationId,
      body: input.body,
      created_by_user_id: input.authorUserId,
      created_by_name: input.authorName,
    })
    .select(COLUNAS)
    .single();
  if (error || !data) throw new Error(error?.message ?? "conversation_note_create_failed");

  await audit({
    action: "conversation.note_added",
    actorUserId: input.authorUserId,
    actorApiTokenId: input.apiTokenId ?? null,
    organizationId: input.organizationId,
    resourceType: "conversation_note",
    resourceId: data.id,
    requestId: input.requestId,
    metadata: { conversation_id: input.conversationId, via: "mcp" },
  });
  await emitirMencoesDaNota(input.db, {
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    body: input.body,
    fromUserId: input.authorUserId,
  });
  return data;
}

export async function removerNotaDaConversa(input: {
  db: SupabaseClient;
  organizationId: string;
  conversationId: string;
  noteId: string;
  actorUserId: string;
  actorRole: Role;
  apiTokenId?: string | null;
  requestId: string;
}) {
  const { data: note, error: noteError } = await input.db
    .from("conversation_notes")
    .select("id, created_by_user_id")
    .eq("id", input.noteId)
    .eq("conversation_id", input.conversationId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (noteError) throw new Error(noteError.message);
  if (!note) throw new Error("conversation_note_not_found");
  if (note.created_by_user_id !== input.actorUserId && !roleAtLeast(input.actorRole, "manager")) {
    throw new Error("conversation_note_delete_forbidden");
  }

  const { data: deleted, error } = await input.db
    .from("conversation_notes")
    .delete()
    .eq("id", input.noteId)
    .eq("conversation_id", input.conversationId)
    .eq("organization_id", input.organizationId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!deleted) throw new Error("conversation_note_not_found");
  await audit({
    action: "conversation.note_deleted",
    actorUserId: input.actorUserId,
    actorApiTokenId: input.apiTokenId ?? null,
    organizationId: input.organizationId,
    resourceType: "conversation_note",
    resourceId: input.noteId,
    requestId: input.requestId,
    metadata: { conversation_id: input.conversationId, via: "mcp" },
  });
  return { deleted: true, note_id: input.noteId };
}

async function emitirMencoesDaNota(
  db: SupabaseClient,
  input: {
    organizationId: string;
    conversationId: string;
    body: string;
    fromUserId: string;
  },
): Promise<void> {
  if (tokensDeMencao(input.body).length === 0) return;
  const { data: members } = await db
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", input.organizationId)
    .is("revoked_at", null);
  const ids = ((members ?? []) as Array<{ user_id: string }>)
    .map((member) => member.user_id)
    .filter((id) => id !== input.fromUserId);
  const preview = input.body.trim().slice(0, 140);
  await Promise.all(
    ids.map(async (userId) => {
      const { data } = await db.auth.admin.getUserById(userId);
      const user = data?.user;
      if (!user?.email) return;
      const fullName =
        typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null;
      if (!mencaoAtingeUsuario(input.body, { id: userId, email: user.email, full_name: fullName }))
        return;
      await db.rpc("emit_event", {
        p_event_type: "user.mentioned",
        p_entity_kind: "conversation_note",
        p_entity_id: input.conversationId,
        p_payload: {
          conversation_id: input.conversationId,
          to_user_id: userId,
          from_user_id: input.fromUserId,
          body_preview: preview,
        },
        p_metadata: {},
        p_organization_id: input.organizationId,
      });
    }),
  );
}
