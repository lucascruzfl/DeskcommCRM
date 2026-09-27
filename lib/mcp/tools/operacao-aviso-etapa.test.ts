import { describe, expect, it, vi } from "vitest";
import type { McpContext } from "../types";
import { ORG_ID, OUTRA_ORG, PIPE, etapa, makeDb } from "@/tests/helpers/stages-db-double";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { crmListStages, crmUpdateStage } from "./operacao";

const STAGE = "55555555-5555-4555-8555-555555555555";

function context(db: ReturnType<typeof makeDb>, organizationId = ORG_ID): McpContext {
  return {
    organizationId,
    role: "manager",
    actor: { type: "api_token", id: "token", role: "manager" },
    apiTokenId: "token",
    requestId: "aviso-etapa-test",
    supabase: db.client,
  } as unknown as McpContext;
}

describe("aviso de etapa pela tool MCP", () => {
  it("aceita a configuração, grava pelo serviço da rota e devolve o estado que a tela lê", async () => {
    const db = makeDb({ stages: [etapa({ id: STAGE, name: "Pedido confirmado" })] });
    const ctx = context(db);
    expect(Object.keys(crmUpdateStage.inputSchema)).toContain("avisar_na_central");

    for (const enabled of [true, false]) {
      const result = await crmUpdateStage.handler(
        {
          pipeline_id: PIPE,
          stage_id: STAGE,
          avisar_na_central: enabled,
        } as never,
        ctx,
      );
      expect(
        (result as { etapas: Array<{ avisar_na_central: boolean }> }).etapas[0]?.avisar_na_central,
      ).toBe(enabled);
      const listed = await crmListStages.handler({ pipeline_id: PIPE }, ctx);
      expect(
        (listed as { etapas: Array<{ avisar_na_central: boolean }> }).etapas[0]?.avisar_na_central,
      ).toBe(enabled);
    }

    expect(
      db.escritas.filter((write) => write.table === "crm_stages").map((write) => write.patch),
    ).toEqual([
      expect.objectContaining({ avisar_na_central: true }),
      expect.objectContaining({ avisar_na_central: false }),
    ]);
  });

  it("não altera a etapa de outra organização usando service role", async () => {
    const db = makeDb({
      pipelineOrg: OUTRA_ORG,
      stages: [etapa({ id: STAGE, name: "Pedido confirmado", organization_id: OUTRA_ORG })],
    });
    await expect(
      crmUpdateStage.handler(
        {
          pipeline_id: PIPE,
          stage_id: STAGE,
          avisar_na_central: true,
        } as never,
        context(db),
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(db.escritas).toEqual([]);
  });
});
