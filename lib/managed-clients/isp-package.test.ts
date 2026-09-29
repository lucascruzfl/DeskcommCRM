import { beforeEach, describe, expect, it, vi } from "vitest";

const operations = vi.hoisted(() => ({ create: vi.fn(), configure: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/pipelines/operations", () => ({
  criarPipeline: operations.create,
  atualizarConfiguracaoDoPipeline: operations.configure,
  atualizarPipeline: operations.update,
}));

import { createIspPackageService, ISP_FIELDS, ISP_LOST_REASONS, ISP_STAGES, ISP_TAGS,
  SEED_PIPELINE_SETTINGS, SEED_PIPELINE_VOCABULARY } from "./isp-package";

const ORG = "00000000-0000-4000-8000-000000000101";
const OTHER = "00000000-0000-4000-8000-000000000102";
const USER = "00000000-0000-4000-8000-000000000103";
const PIPE = "00000000-0000-4000-8000-000000000104";

interface Data {
  platform_admins: Record<string, unknown>[];
  user_organizations: Record<string, unknown>[];
  managed_client_policies: Record<string, unknown>[];
  crm_pipelines: Record<string, unknown>[];
  crm_stages: Record<string, unknown>[];
  crm_leads: Record<string, unknown>[];
  organizations: Record<string, unknown>[];
}

function fixture() {
  const data: Data = {
    platform_admins: [{ user_id: USER, scope: "full", mfa_required: false, revoked_at: null }],
    user_organizations: [{ organization_id: ORG, user_id: USER, role: "admin", revoked_at: null, accepted_at: "2026-01-01" }],
    managed_client_policies: [{ organization_id: ORG, business_type: "internet_provider", management_mode: "managed", preset_id: "managed/internet-provider" }],
    crm_pipelines: [], crm_stages: [], crm_leads: [],
    organizations: [{ id: ORG, settings: { tags: ["minha-tag"] } }],
  };
  const writes: string[] = [];
  const audit = vi.fn(async () => undefined);
  function from(table: keyof Data) {
    const conditions: Array<(row: Record<string, unknown>) => boolean> = [];
    let update: Record<string, unknown> | null = null;
    let orderKey: string | null = null;
    let columns: string | null = null;
    let head = false;
    const projection = (row: Record<string, unknown>) => columns && columns !== "*"
      ? Object.fromEntries(columns.split(",").map((key) => [key.trim(), row[key.trim()]])) : row;
    const q = {
      select: (cols: string, options?: { head?: boolean }) => { columns = cols; head = options?.head === true; return q; },
      eq: (key: string, value: unknown) => { conditions.push((row) => JSON.stringify(row[key]) === JSON.stringify(value)); return q; },
      filter: (key: string, operator: string, value: string) => {
        expect(operator).toBe("eq");
        conditions.push((row) => JSON.stringify(row[key]) === JSON.stringify(JSON.parse(value)));
        return q;
      },
      is: (key: string, value: unknown) => { conditions.push((row) => row[key] === value); return q; },
      not: (key: string, _operator: string, value: unknown) => { conditions.push((row) => row[key] !== value); return q; },
      order: (key: string) => { orderKey = key; return q; },
      update: (patch: Record<string, unknown>) => { update = patch; return q; },
      maybeSingle: async () => {
        const rows = data[table].filter((row) => conditions.every((check) => check(row)));
        if (rows.length > 1) return { data: null, error: { code: "PGRST116" } };
        if (update && rows[0]) { Object.assign(rows[0], update); writes.push(table); }
        return { data: rows[0] ? projection(rows[0]) : null, error: null };
      },
      then: (resolve: (value: { data: Record<string, unknown>[]; count: number; error: null }) => unknown) => {
        const rows = data[table].filter((row) => conditions.every((check) => check(row)));
        if (orderKey) rows.sort((a, b) => Number(a[orderKey!] ?? 0) - Number(b[orderKey!] ?? 0));
        return Promise.resolve(resolve({ data: head ? [] : rows.map(projection), count: rows.length, error: null }));
      },
    };
    return q;
  }
  const service = createIspPackageService({ admin: () => ({ from }) as never, audit: audit as never });
  const actor = { userId: USER, apiTokenId: "00000000-0000-4000-8000-000000000105", requestId: "request-isp" };
  const asJsonb = (value: unknown): unknown => Array.isArray(value) ? value.map(asJsonb)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, asJsonb(nested)]))
      : value;
  operations.create.mockImplementation(async (ctx, input) => {
    expect(ctx.organizationId).toBe(ORG);
    expect(input.etapas).toEqual(ISP_STAGES);
    data.crm_pipelines.push({ id: PIPE, organization_id: ORG, name: input.name, slug: "vendas-internet", is_archived: false,
      is_default: !data.crm_pipelines.some((row) => row.is_default), settings: {} });
    data.crm_stages.push(...ISP_STAGES.map((stage, index) => ({
      organization_id: ORG, pipeline_id: PIPE, name: stage.nome, is_won: stage.passo === "won",
      is_lost: stage.passo === "lost", agent_stage_hint: stage.passo, is_archived: false, position: index + 1,
    })));
    writes.push("crm_pipelines", "crm_stages");
    return { id: PIPE };
  });
  operations.configure.mockImplementation(async (_ctx, id, patch) => {
    expect(id).toBe(PIPE);
    const pipeline = data.crm_pipelines[0]!;
    pipeline.settings = asJsonb({ ...(pipeline.settings as object), ...patch });
    writes.push("crm_pipelines.settings");
  });
  operations.update.mockImplementation(async (_ctx, id, patch) => {
    expect(id).toBe(PIPE);
    expect(patch).toEqual({ is_default: true });
    for (const row of data.crm_pipelines) row.is_default = row.id === PIPE;
    writes.push("crm_pipelines.default");
  });
  return { data, writes, audit, service, actor };
}

beforeEach(() => { operations.create.mockReset(); operations.configure.mockReset(); operations.update.mockReset(); });

describe("pacote operacional ISP gerenciado", () => {
  it("planeja sem escrever e aplica uma única vez, com funil, motivos, campos e tags", async () => {
    const f = fixture();
    const plan = await f.service.preflight(ORG, f.actor);
    expect(plan.can_execute).toBe(true);
    expect(f.writes).toEqual([]);
    const first = await f.service.execute(ORG, f.actor, true);
    if (!("status" in first)) throw new Error("missing_execution_status");
    expect(first.status).toBe("applied");
    expect(f.data.crm_stages.filter((s) => s.is_won)).toHaveLength(1);
    expect(f.data.crm_stages.map((s) => s.name)).toEqual(ISP_STAGES.map((s) => s.nome));
    expect((f.data.crm_pipelines[0]!.settings as Record<string, unknown>).lost_reasons).toEqual(ISP_LOST_REASONS);
    expect((f.data.crm_pipelines[0]!.settings as Record<string, unknown>).fields).toEqual(ISP_FIELDS);
    expect((f.data.organizations[0]!.settings as { tags: string[] }).tags).toEqual(["minha-tag", ...ISP_TAGS]);
    const writes = f.writes.length;
    const second = await f.service.execute(ORG, f.actor, true);
    if (!("status" in second)) throw new Error("missing_execution_status");
    expect(second.status).toBe("already_applied");
    expect(f.writes).toHaveLength(writes);
    expect(operations.create).toHaveBeenCalledTimes(1);
    expect(f.audit).toHaveBeenCalledTimes(1);
  });

  it("falha fechado para clínica, organização comum, outro tenant e ator sem privilégio", async () => {
    const f = fixture();
    f.data.managed_client_policies[0]!.preset_id = "managed/aesthetic-clinic";
    expect((await f.service.preflight(ORG, f.actor)).conflitos).toContain("managed_internet_provider_required");
    f.data.managed_client_policies.length = 0;
    expect((await f.service.preflight(ORG, f.actor)).can_execute).toBe(false);
    expect((await f.service.preflight(OTHER, f.actor)).conflitos).toContain("agency_membership_required");
    f.data.platform_admins[0]!.scope = "support";
    await expect(f.service.execute(ORG, f.actor, true)).rejects.toThrow("managed_isp_package_denied");
    expect(f.writes).toEqual([]);
  });

  it("substitui o padrão genérico apenas quando o seed está intacto e vazio", async () => {
    const f = fixture();
    const seedId = "00000000-0000-4000-8000-000000000106";
    f.data.crm_pipelines.push({ id: seedId, organization_id: ORG, name: "Pedidos", slug: "pedidos",
      is_default: true, is_archived: false, settings: SEED_PIPELINE_SETTINGS,
      vocabulary: SEED_PIPELINE_VOCABULARY });
    f.data.crm_stages.push(...[
      "Carrinho abandonado", "Aguardando pagamento", "Pago", "Em separação",
      "Enviado", "Entregue", "Pós-venda", "Cancelado",
    ].map((name, index) => ({ name, is_won: name === "Pago", is_lost: name === "Cancelado",
      is_archived: false, organization_id: ORG, pipeline_id: seedId, position: index + 1 })));
    const before = await f.service.preflight(ORG, f.actor);
    expect(before.a_criar).toContain("pipeline.default");
    await f.service.execute(ORG, f.actor, true);
    expect(f.data.crm_pipelines.find((row) => row.id === PIPE)?.is_default).toBe(true);
    expect(f.data.crm_pipelines.find((row) => row.id === seedId)?.is_default).toBe(false);
    expect(operations.update).toHaveBeenCalledTimes(1);
  });

  it("preserva funil padrão em uso e informa a decisão pendente", async () => {
    const f = fixture();
    const seedId = "00000000-0000-4000-8000-000000000106";
    f.data.crm_pipelines.push({ id: seedId, organization_id: ORG, name: "Pedidos", slug: "pedidos",
      is_default: true, is_archived: false, settings: SEED_PIPELINE_SETTINGS,
      vocabulary: SEED_PIPELINE_VOCABULARY });
    f.data.crm_stages.push(...[
      "Carrinho abandonado", "Aguardando pagamento", "Pago", "Em separação",
      "Enviado", "Entregue", "Pós-venda", "Cancelado",
    ].map((name, index) => ({ name, is_won: name === "Pago", is_lost: name === "Cancelado",
      is_archived: false, organization_id: ORG, pipeline_id: seedId, position: index + 1 })));
    f.data.crm_leads.push({ organization_id: ORG, pipeline_id: seedId });
    const plan = await f.service.preflight(ORG, f.actor);
    expect(plan.warnings).toContain("default_pipeline_in_use");
    expect(plan.a_criar).not.toContain("pipeline.default");
    await f.service.execute(ORG, f.actor, true);
    expect(operations.update).not.toHaveBeenCalled();
    expect(f.data.crm_pipelines.find((row) => row.id === seedId)?.is_default).toBe(true);
  });

  it("recusa configuração conflitante sem alterar a personalização", async () => {
    const f = fixture();
    f.data.crm_pipelines.push({ id: PIPE, organization_id: ORG, name: "Vendas — Internet", slug: "vendas-internet", settings: { fields: [{ key: "cep", label: "CEP privado", type: "text" }] }, is_archived: false });
    f.data.crm_stages.push(...ISP_STAGES.map((stage, index) => ({ organization_id: ORG, pipeline_id: PIPE,
      name: stage.nome, is_won: stage.passo === "won", is_lost: stage.passo === "lost",
      agent_stage_hint: stage.passo, is_archived: false, position: index + 1 })));
    const preflight = await f.service.preflight(ORG, f.actor);
    expect(preflight.conflitos).toContain("pipeline.fields_conflict");
    await expect(f.service.execute(ORG, f.actor, true)).rejects.toThrow("managed_isp_package_denied");
    expect(f.writes).toEqual([]);
  });

  it("não corrige nem amplia silenciosamente tags duplicadas pelo cliente", async () => {
    const f = fixture();
    f.data.organizations[0]!.settings = { tags: ["sem-cobertura", "SEM-COBERTURA", "minha-tag"] };
    const plan = await f.service.preflight(ORG, f.actor);
    expect(plan.conflitos).toContain("tag:sem-cobertura_duplicate_conflict");
    await expect(f.service.execute(ORG, f.actor, true)).rejects.toThrow("managed_isp_package_denied");
    expect(f.writes).toEqual([]);
  });

  it("não ativa agente, roteador, agenda, cobrança ou integração e expõe dependências", async () => {
    const f = fixture();
    const result = await f.service.execute(ORG, f.actor, true);
    expect(result.pendencias.join(" ")).toMatch(/Comercial.*Suporte.*Financeiro.*Instalação/);
    expect(result.roteamento).toHaveLength(4);
    expect(result.followups.every((flow) => flow.dias === null && flow.acao === "tarefa_interna")).toBe(true);
    expect(f.writes).toEqual(["crm_pipelines", "crm_stages", "crm_pipelines.settings", "organizations"]);
    expect(f.data.crm_pipelines[0]!.settings).not.toHaveProperty("coverage_available");
    expect(f.data.organizations[0]!.settings).not.toHaveProperty("agenda");
  });
});
