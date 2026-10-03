import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/types";
import type { HandlerCtx } from "@/lib/api/handlers/types";

/** Leituras compartilhadas pela rota humana e pelo MCP; o tenant vem do contexto. */
export async function listImportBatchesHandler(db: SupabaseClient, ctx: HandlerCtx) {
  const { data, error } = await db
    .from("import_batches")
    .select("id, filename, status, kind, total_rows, processed_rows, successful_rows, failed_rows, conflict_rows, created_by, created_at, completed_at")
    .eq("organization_id", ctx.organization_id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
  return { batches: data ?? [] };
}

export async function getImportBatchHandler(
  db: SupabaseClient,
  ctx: HandlerCtx,
  id: string,
  status?: string,
) {
  const { data: batch, error } = await db
    .from("import_batches")
    .select("*")
    .eq("organization_id", ctx.organization_id)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
  if (!batch) throw new ApiError(404, "not_found", undefined, ctx.requestId, "Importação não encontrada.");

  let query = db
    .from("import_rows")
    .select("id, row_number, status, error, company_id, person_id, contact_id, raw_data, normalized_data, created_at")
    .eq("organization_id", ctx.organization_id)
    .eq("batch_id", id)
    .order("row_number", { ascending: true })
    .limit(500);
  if (status) query = query.eq("status", status);
  const { data: rows, error: rowsError } = await query;
  if (rowsError) throw new ApiError(500, "internal_error", undefined, ctx.requestId, rowsError.message);
  return { batch, rows: rows ?? [] };
}
