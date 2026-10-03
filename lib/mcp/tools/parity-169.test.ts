import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { PROVIDERS_DE_MENSAGEM } from "@/lib/channels/capabilities";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type * as Skills from "@/lib/agent-engine/agent/skills";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  universal: vi.fn(),
  db: {} as unknown,
  attends: vi.fn(),
  reserve: vi.fn(),
  pool: {},
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/mcp/audit", () => ({ auditMcpToolCall: mocks.universal }));
vi.mock("@/lib/mcp/rate-limit", () => ({ verificarTetoMcp: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.db }));
vi.mock("@/lib/ai/gateway-binding", () => ({ resolverModeloDoPonto: mocks.reserve }));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({ getRequestPool: () => mocks.pool }));
vi.mock("@/lib/ai/agents/quem-atende-a-sessao", () => ({
  haQuemAtendaAOrganizacao: mocks.attends,
}));
vi.mock("@/lib/ai/skills/db", () => ({ getSkillsPool: () => mocks.pool }));
vi.mock("@/lib/agent-engine/agent/skills", async (original) => ({
  ...(await original<typeof Skills>()),
  insertSkillVersion: vi.fn(),
  setSkillPointer: vi.fn(),
}));

import { insertSkillVersion, setSkillPointer } from "@/lib/agent-engine/agent/skills";
import { PACING_DEFAULTS, KNOB_BOUNDS } from "@/lib/agent-engine/pacing/defaults";
import { compararSkill } from "@/lib/ai/skills/comparativo";
import { lerEstadoDoJev, estadoDoJevParaMcp } from "@/lib/ai/decisao/status";
import { TAREFAS_DO_JEV } from "@/lib/ai/decisao/tarefas";
import { MCP_REGISTRY } from "@/lib/mcp/registry";
import { MCP_OPERATION_PRESET } from "@/lib/mcp/scopes";
import { authorizeTool, managedAreaOfTool, domainScope } from "@/lib/mcp/policy";
import { ensureRole, type McpAuthResult } from "@/lib/mcp/auth";
import { catalogEntry } from "@/lib/mcp/tools/catalog";
import { createMcpServer } from "@/lib/mcp/server";
import type { McpContext, McpToolDefinition } from "@/lib/mcp/types";
import { buildManagedAreaPolicy } from "@/lib/managed-clients/policy";
import { MANAGED_CLIENT_PRESETS } from "@/lib/managed-clients/presets";
import { crmGetChannelAdmin, crmUpdateChannelPacing } from "./webhooks-integracoes-canais";
import {
  crmGetAiSkill,
  crmSaveAiSkill,
  crmListAiSkillVersions,
  crmRestoreAiSkillVersion,
} from "./skill-versions";
import { crmGetJevStatus } from "./jev";

const org = "10000000-0000-4000-8000-000000000001";
const otherOrg = "10000000-0000-4000-8000-000000000002";
const channel = "20000000-0000-4000-8000-000000000001";
const foreignChannel = "20000000-0000-4000-8000-000000000002";
const agent = "30000000-0000-4000-8000-000000000001";
const version = "40000000-0000-4000-8000-000000000001";
const adopted = "50000000-0000-4000-8000-000000000001";
const available = "50000000-0000-4000-8000-000000000002";
const saved = "40000000-0000-4000-8000-000000000002";
const token = "60000000-0000-4000-8000-000000000001";
const date = "2026-10-03T10:00:00Z";
const privateText = "CPF 123.456.789-00 email cliente@example.com telefone 5511999999999";
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let mutations: Array<{ table: string; patch: Row }>;
let queries: Array<{ table: string; columns: string; filters: Array<[string, unknown]> }>;
let dbError: string | null;

/** Dublê service-role: aplica os predicados e projeta SELECT. Uma falta de filtro
 * realmente mistura os tenants; ler coluna extra realmente revela o canário. */
function database() {
  return {
    from(table: string) {
      const entry = { table, columns: "", filters: [] as Array<[string, unknown]> };
      queries.push(entry);
      const predicates: Array<(row: Row) => boolean> = [];
      let max = Infinity;
      let head = false;
      let patch: Row | undefined;
      let upsert = false;
      const value = (r: Row, k: string): unknown => {
        if (k.includes("metadata->")) return (r.metadata as Row)?.[k.split(/->>?/)[1]!];
        return r[k];
      };
      const rows = () => (tables[table] ?? []).filter((r) => predicates.every((f) => f(r)));
      const project = (r: Row) => {
        const out: Row = {};
        for (const raw of entry.columns.split(/,(?![^()]*\))/)) {
          const col = raw.trim();
          if (col.includes(":")) {
            const [alias, source] = col.split(":");
            out[alias!] = source!.includes("metadata->") ? value(r, source!) : r[alias!];
          } else if (col) out[col] = r[col];
        }
        return out;
      };
      const finish = () => {
        if (dbError) return { data: null, count: null, error: { message: dbError } };
        if (patch) {
          mutations.push({ table, patch });
          if (upsert) {
            const existing = tables[table]?.find(
              (r) =>
                r.organization_id === patch!.organization_id &&
                r.channel_session_id === patch!.channel_session_id,
            );
            if (existing) Object.assign(existing, patch);
            else (tables[table] ??= []).push({ ...patch });
          } else for (const r of rows()) Object.assign(r, patch);
        }
        const result = rows();
        return {
          data: head ? null : result.slice(0, max).map(project),
          count: result.length,
          error: null,
        };
      };
      const query = {
        select: (columns: string, options?: { head?: boolean }) => {
          entry.columns = columns;
          head = Boolean(options?.head);
          return query;
        },
        eq: (key: string, v: unknown) => {
          entry.filters.push([key, v]);
          if (!key.includes(".")) predicates.push((r) => value(r, key) === v);
          return query;
        },
        is: (key: string, v: unknown) => {
          entry.filters.push([key, v]);
          predicates.push((r) => (value(r, key) ?? null) === v);
          return query;
        },
        not: (key: string, op: string, v: unknown) => {
          if (!key.includes("."))
            predicates.push((r) =>
              op === "is" ? value(r, key) != null : !String(v).includes(String(value(r, key))),
            );
          return query;
        },
        neq: (key: string, v: unknown) => {
          predicates.push((r) => value(r, key) != null && value(r, key) !== v);
          return query;
        },
        gte: (key: string, v: string) => {
          predicates.push((r) => String(value(r, key)) >= v);
          return query;
        },
        or: () => query,
        order: () => query,
        limit: (v: number) => {
          max = v;
          return query;
        },
        range: (_a: number, b: number) => {
          max = b + 1;
          return query;
        },
        update: (v: Row) => {
          patch = v;
          return query;
        },
        upsert: (v: Row) => {
          patch = v;
          upsert = true;
          return query;
        },
        maybeSingle: async () => {
          const res = finish();
          return { ...res, data: res.data?.[0] ?? null };
        },
        single: async () => {
          const res = finish();
          return { ...res, data: res.data?.[0] ?? null };
        },
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(finish()).then(resolve, reject),
      };
      return query;
    },
  };
}
const context = (): McpContext => ({
  organizationId: org,
  role: "manager",
  actor: { type: "api_token", id: token },
  apiTokenId: token,
  requestId: "parity169",
  supabase: mocks.db as McpContext["supabase"],
});
const auth = (scopes: readonly string[] = MCP_OPERATION_PRESET): McpAuthResult => ({
  ...context(),
  scopes: [...scopes],
});
const tool = (name: string) => MCP_REGISTRY.find((t) => t.name === name)!;
async function withClient(policy: McpAuthResult, check: (client: Client) => Promise<void>) {
  const server = createMcpServer(policy, "parity169");
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "parity169", version: "0.0.0" });
  try {
    await server.connect(st);
    await client.connect(ct);
    await check(client);
  } finally {
    await client.close();
    await server.close();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(date));
  vi.useRealTimers();
  mutations = [];
  queries = [];
  dbError = null;
  tables = {
    organizations: [
      { id: org, timezone: "Europe/Lisbon", settings: {} },
      { id: otherOrg, timezone: "Asia/Tokyo", settings: { jev: { ligado: true } } },
    ],
    channel_sessions: [
      {
        id: channel,
        organization_id: org,
        provider: PROVIDERS_DE_MENSAGEM[0],
        archived_at: null,
        daily_message_limit: 80,
        metadata: { password: privateText },
      },
      {
        id: foreignChannel,
        organization_id: otherOrg,
        provider: PROVIDERS_DE_MENSAGEM[0],
        archived_at: null,
        daily_message_limit: 9999,
      },
    ],
    channel_knobs: [
      { organization_id: otherOrg, channel_session_id: foreignChannel, throttle_ms: 99999 },
    ],
    skill_pointers: [
      { organization_id: org, name: "atendimento", version_id: version },
      { organization_id: null, name: "atendimento", version_id: available },
    ],
    skill_versions: [
      {
        id: version,
        organization_id: org,
        name: "atendimento",
        description: "Cópia editada",
        body: privateText,
        matcher: { any_keywords: ["local"] },
        manifest: [],
        forked_from_version_id: adopted,
      },
      {
        id: available,
        organization_id: null,
        name: "atendimento",
        description: "Oficial",
        body: "Passo novo",
        matcher: { any_keywords: ["oficial"] },
      },
    ],
    ai_agents: [{ id: agent, organization_id: org, published_version_id: version }],
    ai_agent_versions: [
      {
        id: version,
        agent_id: agent,
        organization_id: org,
        inbound_debounce_ms: 12000,
        status: "published",
      },
    ],
    ai_provider_credentials: [],
    llm_calls: [],
    messages: [],
    jev_observacoes: [],
    org_guardrail_layers: [],
    ai_routers: [],
    followup_flow_pointers: [],
    followup_flow_versions: [],
  };
  mocks.db = database();
  mocks.attends.mockResolvedValue(false);
  mocks.reserve.mockResolvedValue(null);
  vi.mocked(insertSkillVersion).mockImplementation(async (_pool, input) => {
    const row = {
      id: saved,
      organization_id: input.tenantId,
      name: input.name,
      description: input.description,
      body: input.body,
      matcher: input.matcher,
      forked_from_version_id: input.forkedFromVersionId,
      manifest: [],
    };
    tables.skill_versions!.push(row);
    return row as never;
  });
  vi.mocked(setSkillPointer).mockImplementation(async (_pool, input) => {
    const p = tables.skill_pointers!.find(
      (r) => r.organization_id === input.tenantId && r.name === input.name,
    );
    if (p) p.version_id = input.versionId;
  });
});

describe("v1.69 pacing: leitura e escrita limitada", () => {
  it("leitura herda defaults/fuso, bounds, aquecimento e teto diário sem segredo", async () => {
    const result = await crmGetChannelAdmin.handler({ channel_id: channel }, context());
    expect(result).toMatchObject({
      canal: {
        pacing: {
          daily_message_limit: 80,
          overrides: null,
          effective: { ...PACING_DEFAULTS, timezone: "Europe/Lisbon" },
          defaults: PACING_DEFAULTS,
          bounds: { ...KNOB_BOUNDS },
          warmup: { skipped: false, age_days: 0 },
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain(privateText);
  });
  it("escrita/leitura preservam defaults+overrides, duas janelas e quatro atrasos", async () => {
    const input = {
      channel_id: channel,
      throttle_ms: 4000,
      jitter_max_ms: 800,
      window_start_hour: 8,
      window_end_hour: 20,
      resposta_start_hour: 0,
      resposta_end_hour: 24,
      atraso_notar_ms: 1500,
      ms_por_caractere: 30,
      atraso_minimo_ms: 1000,
      atraso_maximo_ms: 8000,
      allow_sunday: false,
      timezone: "UTC",
      daily_message_limit: 120,
    };
    const result = await crmUpdateChannelPacing.handler(input, context());
    expect(result).toMatchObject({
      daily_message_limit: 120,
      effective: {
        throttleMs: 4000,
        respostaStartHour: 0,
        respostaEndHour: 24,
        windowStartHour: 8,
        windowEndHour: 20,
        atrasoNotarMs: 1500,
        msPorCaractere: 30,
        atrasoMinimoMs: 1000,
        atrasoMaximoMs: 8000,
        allowSunday: false,
        timezone: "UTC",
      },
    });
    expect(mutations.map((m) => m.table)).toEqual(["channel_knobs", "channel_sessions"]);
    expect(tables.channel_sessions![0]).not.toHaveProperty("ai_access");
    expect(mutations[0]!.patch).not.toHaveProperty("warmup_daily_caps");
    expect(mutations[0]!.patch).not.toHaveProperty("number_activated_at");
    const read = await crmGetChannelAdmin.handler({ channel_id: channel }, context());
    expect(read).toMatchObject({ canal: { pacing: result } });
  });
  it("lê o aquecimento escolhido por pessoa e edição A preserva sua declaração", async () => {
    tables.channel_knobs!.push({
      organization_id: org,
      channel_session_id: channel,
      number_activated_at: "2026-01-01T00:00:00Z",
      warmup_daily_caps: [{ minAgeDays: 0, cap: null }],
    });
    const result = await crmUpdateChannelPacing.handler(
      { channel_id: channel, atraso_notar_ms: 1000 },
      context(),
    );
    expect(result).toMatchObject({
      warmup: { skipped: true, cap_today: null, number_activated_at: "2026-01-01T00:00:00Z" },
    });
    expect(mutations[0]!.patch).not.toHaveProperty("number_activated_at");
    expect(mutations[0]!.patch).not.toHaveProperty("warmup_daily_caps");
  });
  it("null retorna ao default e resposta vazia herda janela de disparo", async () => {
    await crmUpdateChannelPacing.handler(
      { channel_id: channel, throttle_ms: 999, window_start_hour: 8 },
      context(),
    );
    const result = await crmUpdateChannelPacing.handler(
      { channel_id: channel, throttle_ms: null },
      context(),
    );
    expect(result).toMatchObject({
      effective: { throttleMs: PACING_DEFAULTS.throttleMs, respostaStartHour: 8 },
      overrides: { throttle_ms: null },
    });
  });
  it.each([foreignChannel, "20000000-0000-4000-8000-000000000099"])(
    "foreign/inexistente %s recusa read e write antes de efeitos",
    async (id) => {
      await expect(crmGetChannelAdmin.handler({ channel_id: id }, context())).rejects.toMatchObject(
        { code: "not_found" },
      );
      await expect(
        crmUpdateChannelPacing.handler({ channel_id: id, throttle_ms: 1200 }, context()),
      ).rejects.toMatchObject({ code: "not_found" });
      expect(mutations).toEqual([]);
    },
  );
  it.each([
    { window_start_hour: 23 },
    { window_end_hour: 7 },
    { resposta_start_hour: 22, resposta_end_hour: 7 },
    { atraso_minimo_ms: 60000, atraso_maximo_ms: 1000 },
  ])("valida o par RESULTANTE %j", async (patch) => {
    await expect(
      crmUpdateChannelPacing.handler({ channel_id: channel, ...patch }, context()),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(mutations).toEqual([]);
  });
  it.each([
    { throttle_ms: KNOB_BOUNDS.intervalMaxMs + 1 },
    { jitter_max_ms: -1 },
    { window_start_hour: 24 },
    { resposta_end_hour: 25 },
    { daily_message_limit: 0 },
    { daily_message_limit: 10001 },
    { timezone: "inválido" },
    { ms_por_caractere: KNOB_BOUNDS.msPorCaractereMax + 1 },
    { atraso_maximo_ms: KNOB_BOUNDS.atrasoMaximoMsMax + 1 },
    { skip_warmup: true },
    { number_activated_at: date },
    { warmup_daily_caps: [] },
    { organization_id: otherOrg },
  ])("recusa bounds/campos B %j", async (patch) => {
    await expect(
      crmUpdateChannelPacing.handler({ channel_id: channel, ...patch } as never, context()),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(mutations).toEqual([]);
  });
  it("recusa canal arquivado e canal sem mensagem", async () => {
    tables.channel_sessions![0]!.archived_at = date;
    await expect(
      crmUpdateChannelPacing.handler({ channel_id: channel, throttle_ms: 100 }, context()),
    ).rejects.toMatchObject({ code: "not_found" });
    tables.channel_sessions![0]!.archived_at = null;
    tables.channel_sessions![0]!.provider = "voice";
    await expect(
      crmUpdateChannelPacing.handler({ channel_id: channel, throttle_ms: 100 }, context()),
    ).rejects.toMatchObject({ code: "not_allowed" });
    expect(mutations).toEqual([]);
  });
  it("falha de leitura não permite escrever sobre defaults inventados", async () => {
    dbError = privateText;
    await expect(
      crmUpdateChannelPacing.handler({ channel_id: channel, throttle_ms: 100 }, context()),
    ).rejects.not.toThrow(privateText);
    expect(mutations).toEqual([]);
  });
  it("auditoria registra campos e flags, sem valores/texto/PII", async () => {
    await withClient(auth(), async (client) => {
      const result = await client.callTool({
        name: crmUpdateChannelPacing.name,
        arguments: { channel_id: channel, timezone: "UTC", daily_message_limit: 120 },
      });
      expect(result.isError).not.toBe(true);
    });
    expect(mocks.universal.mock.lastCall?.[0].args).toEqual({
      channel_id_present: true,
      fields_changed: ["timezone", "daily_message_limit"],
      operation_kind: "pacing_update",
    });
    expect(mocks.audit.mock.lastCall?.[0].metadata).toEqual({
      fields_changed: ["timezone", "daily_message_limit"],
      via: "mcp",
    });
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(privateText);
  });
});

describe("v1.69 debounce: somente leitura da versão", () => {
  it.each([12000, 0, null])("projeções leem %s sem mudar/publicar versão", async (debounce) => {
    tables.ai_agent_versions![0]!.inbound_debounce_ms = debounce;
    const snapshot = JSON.stringify(tables.ai_agent_versions);
    expect(
      await tool("crm_get_ai_agent_version").handler(
        { agent_id: agent, version_id: version },
        context(),
      ),
    ).toMatchObject({ inbound_debounce_ms: debounce });
    expect(
      await tool("crm_list_ai_agent_versions").handler({ agent_id: agent }, context()),
    ).toMatchObject({ versions: [{ inbound_debounce_ms: debounce }] });
    expect(
      await tool("crm_get_published_ai_agent_version").handler({ agent_id: agent }, context()),
    ).toMatchObject({ published: true, version: { inbound_debounce_ms: debounce } });
    expect(JSON.stringify(tables.ai_agent_versions)).toBe(snapshot);
    expect(mutations).toEqual([]);
  });
  it("não lê versão/agente da org vizinha", async () => {
    tables.ai_agent_versions![0]!.organization_id = otherOrg;
    tables.ai_agents![0]!.organization_id = otherOrg;
    await expect(
      tool("crm_get_ai_agent_version").handler({ agent_id: agent, version_id: version }, context()),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      tool("crm_get_published_ai_agent_version").handler({ agent_id: agent }, context()),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(
      await tool("crm_list_ai_agent_versions").handler({ agent_id: agent }, context()),
    ).toEqual({ versions: [] });
  });
  it("não acrescenta escrita de debounce aos schemas MCP", () => {
    const patch = tool("crm_update_ai_agent_version").inputSchema.patch as z.ZodType;
    const create = tool("crm_create_ai_agent_version").inputSchema.version as z.ZodType;
    expect(patch.safeParse({ inbound_debounce_ms: 10 }).success).toBe(false);
    const base = {
      system_prompt: "Você atende os clientes.",
      provider: "anthropic",
      model: "claude",
      credential_id: null,
      channel_session_id: null,
    };
    expect(create.safeParse(base).success).toBe(true);
    expect(create.safeParse({ ...base, inbound_debounce_ms: 10 }).success).toBe(false);
    const initial = tool("crm_create_ai_agent").inputSchema.version as z.ZodType;
    expect(initial.safeParse(base).success).toBe(true);
    expect(initial.safeParse({ ...base, inbound_debounce_ms: 10 }).success).toBe(false);
  });
});

describe("v1.69 Skills: comparação e origem imutável", () => {
  it("versão nova compara com o serviço canônico sem pacote nem adoção", async () => {
    const before = JSON.stringify(tables.skill_pointers);
    const result = await crmGetAiSkill.handler({ name: "atendimento" }, context());
    expect(result).toMatchObject({
      source: "catalog",
      forked_from_version_id: adopted,
      version_id: version,
      catalog_version_id: available,
      versao_nova_catalogo: true,
      comparativo: compararSkill(
        tables.skill_versions![0] as never,
        tables.skill_versions![1] as never,
      ),
    });
    expect(JSON.stringify(tables.skill_pointers)).toBe(before);
    expect(result).not.toHaveProperty("manifest");
    expect(mutations).toEqual([]);
  });
  it.each(["atual", "manual", "fora-do-catálogo"])("%s não avisa atualização", async (mode) => {
    if (mode === "atual") tables.skill_versions![0]!.forked_from_version_id = available;
    if (mode === "manual") tables.skill_versions![0]!.forked_from_version_id = null;
    if (mode === "fora-do-catálogo")
      tables.skill_pointers = tables.skill_pointers!.filter((r) => r.organization_id !== null);
    expect(await crmGetAiSkill.handler({ name: "atendimento" }, context())).toMatchObject({
      versao_nova_catalogo: false,
      comparativo: null,
    });
  });
  it("MCP save mantém a versão oficial ADOTADA e cópia anterior no histórico", async () => {
    const previous = JSON.stringify(tables.skill_versions![0]);
    const input = {
      name: "atendimento",
      description: "Editada",
      body: "Procedimento local",
      matcher: { any_keywords: ["local"] },
    };
    await crmSaveAiSkill.handler(input, context());
    expect(insertSkillVersion).toHaveBeenCalledWith(mocks.pool, {
      tenantId: org,
      ...input,
      forkedFromVersionId: adopted,
    });
    expect(JSON.stringify(tables.skill_versions![0])).toBe(previous);
    expect(await crmGetAiSkill.handler({ name: "atendimento" }, context())).toMatchObject({
      version_id: saved,
      source: "catalog",
      forked_from_version_id: adopted,
      catalog_version_id: available,
      versao_nova_catalogo: true,
    });
    expect(await crmListAiSkillVersions.handler({ name: "atendimento" }, context())).toMatchObject({
      versions: [
        { id: version, atual: false, forked_from_version_id: adopted },
        { id: saved, atual: true, forked_from_version_id: adopted },
      ],
    });
    await crmRestoreAiSkillVersion.handler({ name: "atendimento", version_id: version }, context());
    expect(await crmGetAiSkill.handler({ name: "atendimento" }, context())).toMatchObject({
      version_id: version,
      forked_from_version_id: adopted,
    });
  });
  it("skill manual editada não vira catálogo", async () => {
    tables.skill_versions![0]!.forked_from_version_id = null;
    await crmSaveAiSkill.handler(
      { name: "atendimento", description: "Editada", body: "Nova", matcher: { any_keywords: [] } },
      context(),
    );
    expect(await crmGetAiSkill.handler({ name: "atendimento" }, context())).toMatchObject({
      source: "manual",
      versao_nova_catalogo: false,
    });
  });
  it("tenant A não lê/salva/restaura Skill B nem usa B como catálogo", async () => {
    tables.skill_versions![0]!.organization_id = otherOrg;
    await expect(crmGetAiSkill.handler({ name: "atendimento" }, context())).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      crmSaveAiSkill.handler(
        { name: "atendimento", description: "D", body: "B", matcher: { any_keywords: [] } },
        context(),
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      crmRestoreAiSkillVersion.handler({ name: "atendimento", version_id: version }, context()),
    ).rejects.toMatchObject({ status: 404 });
    expect(insertSkillVersion).not.toHaveBeenCalled();
    expect(setSkillPointer).not.toHaveBeenCalled();
  });
  it("pacote recusa save e auditoria omite corpo, keywords e diff", async () => {
    tables.skill_versions![0]!.manifest = [{ path: "sigilo.bin" }];
    await expect(
      crmSaveAiSkill.handler(
        {
          name: "atendimento",
          description: privateText,
          body: privateText,
          matcher: { any_keywords: [privateText] },
        },
        context(),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(insertSkillVersion).not.toHaveBeenCalled();
    await withClient(auth(), async (client) => {
      await client.callTool({ name: crmGetAiSkill.name, arguments: { name: "atendimento" } });
    });
    expect(JSON.stringify(mocks.universal.mock.calls)).not.toContain(privateText);
    expect(
      JSON.stringify(
        crmSaveAiSkill.redigirParaAuditoria?.({
          name: "atendimento",
          description: privateText,
          body: privateText,
          matcher: { any_keywords: [privateText] },
        }),
      ),
    ).not.toContain(privateText);
  });
});

function enableJev(extra: Row = {}) {
  tables.organizations![0]!.settings = {
    jev: {
      ligado: true,
      modo: "observacao",
      aceite: { em: date, por: token, alcance: "mensagem" },
      ...extra,
    },
  };
}
async function statusJev() {
  return (await crmGetJevStatus.handler({}, context())) as ReturnType<typeof estadoDoJevParaMcp>;
}

describe("v1.69 Jev: observabilidade agregada no read-model da tela", () => {
  it("desligado: todas desligadas, sem mutação", async () => {
    const result = await statusJev();
    expect(result.config.ligado).toBe(false);
    expect(result.por_tarefa).toHaveLength(6);
    expect(result.por_tarefa.every((t) => t.estado === "desligada")).toBe(true);
    expect(mutations).toEqual([]);
  });
  it("ligado: tarefa nova observa; follow-up only-observe nunca decide", async () => {
    enableJev({
      tarefas: { followup: { estado: "decidindo" }, manipulacao: { estado: "observando" } },
    });
    const result = await statusJev();
    expect(result.por_tarefa.find((t) => t.id === "roteador")).toMatchObject({
      novo: true,
      estado: "observando",
      pode_decidir: true,
    });
    expect(result.por_tarefa.find((t) => t.id === "manipulacao")).toMatchObject({
      novo: false,
      estado: "observando",
    });
    expect(result.por_tarefa.find((t) => t.id === "followup")).toMatchObject({
      so_observa: true,
      pode_decidir: false,
      estado: "observando",
    });
  });
  it("sem camada/roteador/atendente/follow-up elegível preserva impedimentos", async () => {
    enableJev();
    tables.org_guardrail_layers = [{ organization_id: org, layer: "jailbreak", enabled: false }];
    const result = await statusJev();
    expect(result.por_tarefa.find((t) => t.id === "manipulacao")?.sem_camada).toBe(true);
    expect(result.por_tarefa.find((t) => t.id === "roteador")?.sem_roteador).toBe(true);
    expect(result.por_tarefa.find((t) => t.id === "humano")?.sem_atendente).toBe("ninguem_no_ar");
    expect(result.por_tarefa.find((t) => t.id === "followup")?.sem_fluxo).toBe(true);
  });
  it("roteador, fluxo e atendente elegíveis são reconhecidos sem escrever", async () => {
    enableJev();
    mocks.attends.mockResolvedValue(true);
    tables.ai_routers = [{ organization_id: org, is_active: true, intencoes: [{ count: 2 }] }];
    tables.followup_flow_pointers = [
      {
        organization_id: org,
        status: "active",
        versao: {
          graph: { nodes: [{ type: "ai_classify", config: { classes: ["sim", "não"] } }] },
        },
      },
    ];
    const result = await statusJev();
    expect(result.por_tarefa.find((t) => t.id === "roteador")?.sem_roteador).toBe(false);
    expect(result.por_tarefa.find((t) => t.id === "followup")?.sem_fluxo).toBe(false);
    expect(result.por_tarefa.find((t) => t.id === "humano")?.sem_atendente).toBe(null);
    expect(mutations).toEqual([]);
  });
  it("sem aceite permanece desligado; modo externo impede os pedidos", async () => {
    enableJev({ aceite: null });
    expect((await statusJev()).config.ligado).toBe(false);
    enableJev();
    (tables.organizations![0]!.settings as Row).ai_dispatch_mode = "external";
    expect((await statusJev()).por_tarefa.find((t) => t.id === "opt_out")?.sem_atendente).toBe(
      "externo",
    );
  });
  it("modelo da tela é a fonte de estados, contagens e concordância", async () => {
    enableJev();
    tables.jev_observacoes = [
      {
        organization_id: org,
        tarefa: "manipulacao",
        concordou: true,
        rotulo_jev: "high",
        rotulo_atual: "high",
        created_at: date,
      },
      {
        organization_id: org,
        tarefa: "manipulacao",
        concordou: false,
        rotulo_jev: "high",
        rotulo_atual: "low",
        created_at: date,
      },
      {
        organization_id: org,
        tarefa: "humano",
        rotulo_jev: "sim",
        conversation_id: channel,
        created_at: date,
        texto: privateText,
      },
      {
        organization_id: otherOrg,
        tarefa: "humano",
        rotulo_jev: "sim",
        conversation_id: foreignChannel,
        created_at: date,
      },
    ];
    tables.llm_calls = [
      {
        organization_id: org,
        purpose: "sentiment_classify",
        provider: "typesafe",
        status: "ok",
        cost_cents: 2,
        latency_ms: 100,
        created_at: date,
      },
      {
        organization_id: otherOrg,
        purpose: "sentiment_classify",
        provider: "typesafe",
        status: "ok",
        cost_cents: 999,
        latency_ms: 999,
        created_at: date,
      },
    ];
    const model = await lerEstadoDoJev(context().supabase, org);
    expect(await statusJev()).toEqual(estadoDoJevParaMcp(model));
    expect(model.por_tarefa.find((t) => t.id === "manipulacao")?.observacao).toMatchObject({
      comparadas: 2,
      concordaram: 1,
      so_o_jev_alto: 1,
    });
    expect(await statusJev()).toMatchObject({
      numeros: { decisoes: 1, custo_cents: 2, latencia_media_ms: 100 },
    });
    const result = await statusJev();
    expect(result.por_tarefa.find((t) => t.id === "humano")?.percebidos).toEqual({
      dias: 30,
      mensagens: 1,
    });
    expect(JSON.stringify(result)).not.toContain(privateText);
    expect(JSON.stringify(result)).not.toContain(foreignChannel);
    expect(JSON.stringify(result)).not.toContain("/app/inbox");
    expect(mocks.attends).toHaveBeenCalledWith(mocks.pool, org);
    expect(mocks.reserve).toHaveBeenCalledWith(
      "sentiment_classify",
      org,
      expect.anything(),
      expect.anything(),
    );
  });
  it("configuração/credenciais/métricas da org B não vazam para A", async () => {
    tables.organizations![1]!.settings = {
      jev: { ligado: true, aceite: { em: date, por: token } },
    };
    tables.ai_provider_credentials = [
      {
        organization_id: otherOrg,
        provider: "typesafe",
        is_active: true,
        validated_at: date,
        label: privateText,
        validation_error: privateText,
      },
    ];
    tables.jev_observacoes = [
      { organization_id: otherOrg, tarefa: "followup", concordou: true, created_at: date },
    ];
    const result = await statusJev();
    expect(result.config.ligado).toBe(false);
    expect(result.chave.existe).toBe(false);
    expect(result.por_tarefa.find((t) => t.id === "followup")?.observacao?.comparadas).toBe(0);
    expect(JSON.stringify(result)).not.toContain(privateText);
    for (const q of queries)
      expect(q.filters).toContainEqual([
        q.table === "organizations" ? "id" : "organization_id",
        org,
      ]);
  });
  it("falha segura não devolve erro livre de credencial/provedor, consentimento ou mensagem", async () => {
    enableJev();
    tables.ai_provider_credentials = [
      {
        organization_id: org,
        provider: "typesafe",
        is_active: true,
        created_at: date,
        label: privateText,
        validation_error: privateText,
      },
    ];
    tables.llm_calls = [
      {
        organization_id: org,
        purpose: "sentiment_classify",
        provider: "typesafe",
        status: "erro",
        error_code: privateText,
        cost_cents: null,
        created_at: date,
      },
    ];
    const result = await statusJev();
    expect(result.chave.falha_validacao).toBe(true);
    expect(result.ultima_falha?.motivo).toBe("jev_falha");
    expect(JSON.stringify(result)).not.toContain(privateText);
    expect(result.config).not.toHaveProperty("aceite");
    dbError = privateText;
    await expect(statusJev()).rejects.toThrow("jev_status_read_failed");
  });
  it("não registra qualquer operação write Jev no MCP", () => {
    expect(MCP_REGISTRY.filter((t) => /jev/.test(t.name)).map((t) => [t.name, t.category])).toEqual(
      [["crm_get_jev_status", "read"]],
    );
    expect(TAREFAS_DO_JEV).toHaveLength(6);
    expect(crmGetJevStatus.inputSchema).toEqual({});
  });
});

const administrativeTools = [
  crmGetChannelAdmin,
  crmUpdateChannelPacing,
  crmGetAiSkill,
  crmSaveAiSkill,
  crmGetJevStatus,
  tool("crm_get_ai_agent_version"),
  tool("crm_list_ai_agent_versions"),
  tool("crm_get_published_ai_agent_version"),
] as unknown as McpToolDefinition[];
describe("v1.69 registry, catálogo, scopes, roles e managed policy", () => {
  it("1:1, manager, domains e áreas exatas", () => {
    for (const t of administrativeTools) {
      expect(MCP_REGISTRY.filter((r) => r.name === t.name)).toEqual([t]);
      expect(catalogEntry(t.name)?.category).toBe(t.category);
      expect(catalogEntry(t.name)?.apenasHumano).toBe(true);
      expect(t.requiresRole).toBe("manager");
      expect(() => ensureRole("agent", t.requiresRole)).toThrow();
      expect(() => authorizeTool(auth(), t)).not.toThrow();
      expect(Object.keys(t.inputSchema)).not.toContain("organization_id");
    }
    expect(managedAreaOfTool(crmGetJevStatus)).toBe("/app/ai/atendimento");
    expect(managedAreaOfTool(crmUpdateChannelPacing as unknown as McpToolDefinition)).toBe(
      "/app/connections",
    );
    expect(domainScope(crmGetJevStatus)).toBe("ai:read");
  });
  it("scopes globais/granulares/allowlist e capability são preservados", () => {
    for (const t of administrativeTools) {
      expect(() => authorizeTool(auth([]), t)).toThrow("scope_missing");
      expect(() => authorizeTool(auth([t.requiresScope, "contacts:read"]), t)).toThrow(
        "scope_missing",
      );
      expect(() => authorizeTool(auth([t.requiresScope, "tool:crm_get_contact"]), t)).toThrow(
        "not_allowed",
      );
    }
    expect(() =>
      authorizeTool(
        auth(MCP_OPERATION_PRESET.filter((s) => s !== "capability:agent_publication")),
        crmSaveAiSkill as unknown as McpToolDefinition,
      ),
    ).toThrow("capability_missing");
    const oldFull = MCP_OPERATION_PRESET.filter(
      (s) => !["tool:crm_get_jev_status", "tool:crm_update_channel_pacing"].includes(s),
    );
    expect(() => authorizeTool(auth(oldFull), crmGetJevStatus)).not.toThrow();
  });
  it("managed policy recusa áreas fechadas e libera só override exato", () => {
    const preset = Object.values(MANAGED_CLIENT_PRESETS)[0]!;
    for (const t of [crmGetJevStatus, crmUpdateChannelPacing] as unknown as McpToolDefinition[]) {
      const area = managedAreaOfTool(t)!;
      const denied = buildManagedAreaPolicy(preset.id, [{ href: area, classification: "agency" }]);
      expect(() => authorizeTool({ ...auth(), managedPolicy: denied }, t)).toThrow(
        "managed_area_denied",
      );
      const allowed = buildManagedAreaPolicy(preset.id, [{ href: area, classification: "shared" }]);
      expect(() => authorizeTool({ ...auth(), managedPolicy: allowed }, t)).not.toThrow();
    }
  });
  it("MCP externo: manager vê/executa as leituras, agent não recebe administração", async () => {
    await withClient(auth(), async (client) => {
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toContain(crmGetJevStatus.name);
      expect(names).toContain(crmUpdateChannelPacing.name);
      const result = await client.callTool({ name: crmGetJevStatus.name, arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(mocks.universal.mock.calls)).not.toContain(privateText);
    });
    await withClient({ ...auth(), role: "agent" }, async (client) => {
      const names = (await client.listTools()).tools.map((t) => t.name);
      for (const t of administrativeTools) expect(names).not.toContain(t.name);
    });
    expect(mutations).toEqual([]);
  });
  it("schemas do catálogo refletem a escrita A, sem operações B ocultas", () => {
    const shape = crmUpdateChannelPacing.inputSchema;
    expect(Object.keys(shape)).not.toContain("skip_warmup");
    expect(Object.keys(shape)).not.toContain("number_activated_at");
    expect(
      z.object(shape).strict().safeParse({ channel_id: channel, skip_warmup: true }).success,
    ).toBe(false);
  });
});
