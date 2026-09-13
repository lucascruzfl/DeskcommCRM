import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));

import { audit } from "@/lib/audit";
import {
  ORG_ID,
  OUTRA_ORG,
  PIPE,
  etapa,
  funil,
  funilRow,
  makeDb,
  negocio,
} from "@/tests/helpers/stages-db-double";
import type { McpContext } from "../types";
import {
  crmCreatePipeline,
  crmManagePipelineFields,
  crmManagePipelineStages,
  crmUpdatePipeline,
} from "./pipelines";

const OUTRO_PIPE = "55555555-5555-4555-8555-555555555555";
const STAGE_A = "66666666-6666-4666-8666-666666666661";
const STAGE_B = "66666666-6666-4666-8666-666666666662";

function ctx(client: ReturnType<typeof makeDb>["client"], role: "manager" | "admin" = "admin"): McpContext {
  return {
    organizationId: ORG_ID,
    role,
    actor: { type: "ai_agent", id: "run-1", role, api_token_id: "token-1" },
    apiTokenId: "token-1",
    requestId: "request-1",
    supabase: client as never,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("administração MCP de pipelines", () => {
  it("publica schemas fechados no organization_id e com os tipos reais de campo", () => {
    for (const tool of [
      crmCreatePipeline,
      crmUpdatePipeline,
      crmManagePipelineStages,
      crmManagePipelineFields,
    ]) {
      expect(tool.inputSchema).not.toHaveProperty("organization_id");
    }
    const schema = z.object(crmManagePipelineFields.inputSchema);
    expect(schema.safeParse({
      pipeline_id: PIPE,
      operation: "create",
      field: { key: "canal", label: "Canal", type: "multiselect" },
    }).success).toBe(true);
    expect(schema.safeParse({
      pipeline_id: PIPE,
      operation: "create",
      field: { key: "canal", label: "Canal", type: "inventado" },
    }).success).toBe(false);
  });

  it("cria pipeline com organização do token, quatro etapas e auditoria", async () => {
    const db = makeDb({ pipelines: [] });
    const result = await crmCreatePipeline.handler({ name: "Comercial" }, ctx(db.client));

    expect(result).toMatchObject({ pipeline_id: expect.any(String) });
    expect(db.escritas[0]).toMatchObject({
      table: "crm_pipelines",
      patch: expect.objectContaining({ organization_id: ORG_ID, name: "Comercial" }),
    });
    const stages = db.escritas.find((write) => write.table === "crm_stages")?.patch;
    expect(stages).toHaveLength(4);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "pipeline.created", organizationId: ORG_ID }));
  });

  it("edita somente pipeline da organização do token", async () => {
    const db = makeDb({
      pipelines: [
        funilRow({ id: PIPE, name: "Meu funil" }),
        funilRow({ id: OUTRO_PIPE, name: "Alheio", organization_id: OUTRA_ORG }),
      ],
    });
    await crmUpdatePipeline.handler({ pipeline_id: PIPE, description: "B2B" }, ctx(db.client));
    expect(db.escritas[0]?.filtros).toContainEqual(["organization_id", ORG_ID]);

    await expect(
      crmUpdatePipeline.handler({ pipeline_id: OUTRO_PIPE, name: "Tentativa" }, ctx(db.client)),
    ).rejects.toMatchObject({ code: "pipeline_not_found" });
    expect(db.escritas).toHaveLength(1);
  });

  it("cria, edita e reordena etapa pelo serviço interno existente", async () => {
    const stages = funil().map((item, index) => ({
      ...item,
      id: [STAGE_A, STAGE_B, "66666666-6666-4666-8666-666666666663", "66666666-6666-4666-8666-666666666664"][index]!,
      slug: `stage_${index}`,
    }));
    const db = makeDb({ pipelines: [funilRow({ id: PIPE, name: "Comercial" })], stages });

    const created = await crmManagePipelineStages.handler(
      { pipeline_id: PIPE, operation: "create", name: "Qualificação" },
      ctx(db.client),
    );
    expect(created).toMatchObject({ operation: "create", stage_id: expect.any(String) });

    await crmManagePipelineStages.handler(
      { pipeline_id: PIPE, operation: "update", stage_id: STAGE_B, name: "Proposta enviada" },
      ctx(db.client),
    );
    await crmManagePipelineStages.handler(
      { pipeline_id: PIPE, operation: "reorder", stage_id: STAGE_B, after_stage_id: null },
      ctx(db.client),
    );
    expect(db.escritas.filter((write) => write.table === "crm_stages")).toHaveLength(3);
    expect(db.escritas.every((write) =>
      write.table !== "crm_stages" || write.tipo === "insert" || write.filtros.some(([key, value]) => key === "organization_id" && value === ORG_ID)
    )).toBe(true);
  });

  it("ao arquivar etapa com leads, exige destino e move antes de arquivar", async () => {
    const stages = [
      etapa({ id: STAGE_A, name: "Novo", position: 1000 }),
      etapa({ id: STAGE_B, name: "Contato", position: 2000 }),
      etapa({ id: "66666666-6666-4666-8666-666666666663", name: "Ganho", position: 3000, is_won: true }),
      etapa({ id: "66666666-6666-4666-8666-666666666664", name: "Perdido", position: 4000, is_lost: true }),
    ];
    const db = makeDb({ stages, leads: [negocio("lead-1", STAGE_A)] });

    await expect(
      crmManagePipelineStages.handler(
        { pipeline_id: PIPE, operation: "archive", stage_id: STAGE_A },
        ctx(db.client),
      ),
    ).rejects.toMatchObject({ code: "unprocessable_entity" });

    await crmManagePipelineStages.handler(
      { pipeline_id: PIPE, operation: "archive", stage_id: STAGE_A, move_leads_to_stage_id: STAGE_B },
      ctx(db.client),
    );
    const writes = db.escritas.slice(-3).map((write) => write.table);
    expect(writes[0]).toBe("crm_leads");
    expect(writes[1]).toBe("crm_stages");
  });

  it("cria, edita, reordena e remove campos usando settings.fields", async () => {
    const db = makeDb({
      pipelines: [funilRow({ id: PIPE, name: "Comercial", settings: { fields: [] } })],
    });
    const context = ctx(db.client);

    await crmManagePipelineFields.handler(
      { pipeline_id: PIPE, operation: "create", field: { key: "empresa", label: "Empresa", type: "text" } },
      context,
    );
    await crmManagePipelineFields.handler(
      { pipeline_id: PIPE, operation: "create", field: { key: "porte", label: "Porte", type: "select", options: [{ value: "p", label: "Pequeno" }] } },
      context,
    );
    await crmManagePipelineFields.handler(
      { pipeline_id: PIPE, operation: "update", field_key: "empresa", field: { required: true } },
      context,
    );
    await crmManagePipelineFields.handler(
      { pipeline_id: PIPE, operation: "reorder", field_key: "porte", after_field_key: null },
      context,
    );
    const reordered = (db.tabelas.crm_pipelines[0]?.settings as { fields: Array<{ key: string }> }).fields;
    expect(reordered.map((field) => field.key)).toEqual(["porte", "empresa"]);

    await crmManagePipelineFields.handler(
      { pipeline_id: PIPE, operation: "delete", field_key: "empresa" },
      context,
    );
    const finalFields = (db.tabelas.crm_pipelines[0]?.settings as { fields: Array<{ key: string }> }).fields;
    expect(finalFields.map((field) => field.key)).toEqual(["porte"]);
    expect(db.escritas.every((write) =>
      write.table !== "crm_pipelines" || write.tipo === "insert" || write.filtros.some(([key, value]) => key === "organization_id" && value === ORG_ID)
    )).toBe(true);
  });

  it("campo de pipeline de outro tenant responde pipeline_not_found sem escrita", async () => {
    const db = makeDb({
      pipelines: [funilRow({ id: OUTRO_PIPE, name: "Alheio", organization_id: OUTRA_ORG, settings: { fields: [] } })],
    });
    await expect(
      crmManagePipelineFields.handler(
        { pipeline_id: OUTRO_PIPE, operation: "create", field: { key: "x", label: "X", type: "text" } },
        ctx(db.client),
      ),
    ).rejects.toMatchObject({ code: "pipeline_not_found" });
    expect(db.escritas).toEqual([]);
  });
});
