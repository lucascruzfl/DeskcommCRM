import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/followup/rascunho", () => ({ rascunhoDoFluxo: vi.fn(async () => ({ nodes: [], edges: [] })) }));

import type { SupabaseClient } from "@supabase/supabase-js";
import { duplicarFluxo } from "./duplicar-fluxo";

const org = "11111111-1111-4111-8111-111111111111";
const source = "22222222-2222-4222-8222-222222222222";
const copy = "33333333-3333-4333-8333-333333333333";

describe("duplicação canônica de follow-up", () => {
  it("filtra a empresa e cria somente rascunho sem versão ativa", async () => {
    const filters: Array<[string, unknown]> = [];
    let reads = 0;
    let inserted: Record<string, unknown> | null = null;
    const db = {
      from: (table: string) => {
        expect(table).toBe("followup_flow_pointers");
        const q = {
          select: () => q,
          eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
          maybeSingle: async () => ({ data: {
            id: source, name: "Voltar", draft_graph: null, active_version_id: null,
            trigger_config: { kind: "manual" }, handoff_policy: "pause", surface: "followup",
          }, error: null }),
          then: (resolve: (value: unknown) => void) => {
            reads += 1;
            resolve({ data: [{ name: "Voltar" }], error: null });
          },
          insert: (value: Record<string, unknown>) => { inserted = value; return q; },
          single: async () => ({ data: { id: copy, ...inserted }, error: null }),
        };
        return q;
      },
    } as unknown as SupabaseClient;
    const result = await duplicarFluxo(db, org, source, "req");
    expect(filters).toContainEqual(["organization_id", org]);
    expect(filters).toContainEqual(["id", source]);
    expect(reads).toBe(1);
    expect(inserted).toMatchObject({ organization_id: org, status: "draft" });
    expect(inserted).not.toHaveProperty("active_version_id");
    expect(result.copia.id).toBe(copy);
  });
});
