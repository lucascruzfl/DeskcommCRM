/** Operação canônica de duplicação usada pela tela e pelo MCP. */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/types";
import { nomeDaCopia } from "@/lib/followup/nome-da-copia";
import { rascunhoDoFluxo } from "@/lib/followup/rascunho";

const SOURCE_COLUMNS =
  "id, name, draft_graph, trigger_config, handoff_policy, surface, active_version_id";

export async function duplicarFluxo(
  db: SupabaseClient,
  organizationId: string,
  sourceId: string,
  requestId: string,
) {
  const { data: origem, error: fetchError } = await db
    .from("followup_flow_pointers")
    .select(SOURCE_COLUMNS)
    .eq("id", sourceId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (fetchError) throw new ApiError(500, "internal_error", undefined, requestId);
  if (!origem) throw new ApiError(404, "not_found", undefined, requestId, "Fluxo não encontrado.");

  const { data: nomes, error: namesError } = await db
    .from("followup_flow_pointers")
    .select("name")
    .eq("organization_id", organizationId);
  if (namesError) throw new ApiError(500, "internal_error", undefined, requestId);

  const draft_graph = await rascunhoDoFluxo(
    db,
    origem as { draft_graph: unknown; active_version_id: string | null },
    organizationId,
  );
  const name = nomeDaCopia(
    String(origem.name),
    (nomes ?? []).map((r) => String((r as { name: string }).name)),
  );
  const { data: copia, error: insertError } = await db
    .from("followup_flow_pointers")
    .insert({
      organization_id: organizationId,
      name,
      status: "draft",
      draft_graph,
      trigger_config: origem.trigger_config,
      handoff_policy: origem.handoff_policy,
      surface: origem.surface ?? "followup",
    })
    .select("*")
    .single();
  if (insertError?.code === "23505")
    throw new ApiError(409, "conflict", undefined, requestId, "Já existe um fluxo com este nome.");
  if (insertError || !copia) throw new ApiError(500, "internal_error", undefined, requestId);
  return { copia, name };
}
