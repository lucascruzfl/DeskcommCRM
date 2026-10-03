import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { HandlerCtx } from "@/lib/api/handlers/types";
import { getImportBatchHandler, listImportBatchesHandler } from "./import-handlers";

const orgA = "10000000-0000-4000-8000-000000000001";
const orgB = "20000000-0000-4000-8000-000000000002";
const batchA = "30000000-0000-4000-8000-000000000003";
const batchB = "40000000-0000-4000-8000-000000000004";
const ctx = { organization_id: orgA, requestId: "b2b-test", actor: { type: "api_token", id: "token" } } as HandlerCtx;

function database() {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    import_batches: [
      { id: batchA, organization_id: orgA, filename: "a.csv" },
      { id: batchB, organization_id: orgB, filename: "b.csv" },
    ],
    import_rows: [
      { id: "row-a", organization_id: orgA, batch_id: batchA, status: "success", raw_data: { name: "A" } },
      { id: "row-b", organization_id: orgB, batch_id: batchB, status: "failed", raw_data: { name: "B" } },
    ],
  };
  const db = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const rows = () => tables[table]!.filter((row) => filters.every(([key, value]) => row[key] === value));
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: rows(), error: null })),
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return db;
}

describe("leituras compartilhadas de lotes B2B", () => {
  it("lista só lotes do tenant do token", async () => {
    expect((await listImportBatchesHandler(database(), ctx)).batches.map((row) => row.id)).toEqual([batchA]);
  });

  it("ID de outro tenant falha fechado; lote próprio não traz linhas alheias", async () => {
    await expect(getImportBatchHandler(database(), ctx, batchB)).rejects.toMatchObject({ status: 404 });
    const result = await getImportBatchHandler(database(), ctx, batchA);
    expect(result.batch.id).toBe(batchA);
    expect(result.rows.map((row) => row.id)).toEqual(["row-a"]);
  });
});
