import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { McpContext } from "@/lib/mcp/types";

vi.mock("@/lib/audit", () => ({ audit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/escalacao/atendentes", () => ({
  carregarRosterDeAtendimento: vi.fn().mockResolvedValue([]),
}));

const {
  AGENDA_ADMIN_MCP_TOOLS,
  crmCreateAvailabilityException,
  crmCreateEventType,
  crmDeleteAvailabilityException,
  crmGetEventType,
  crmUpdateAvailability,
  crmUpdateEventType,
} = await import("@/lib/mcp/tools/agenda-administracao");
const { crmSetAppointmentOutcome } = await import("@/lib/mcp/tools/agendamento");

const ORG = "aaaaaaaa-1111-4111-8111-111111111111";
const USER = "aaaaaaaa-2222-4222-8222-222222222222";
const ID = "aaaaaaaa-3333-4333-8333-333333333333";

type Query = {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  filters: Record<string, unknown>;
  values?: unknown;
};

function fakeDb(resolve: (query: Query) => { data: unknown; error: unknown }) {
  const calls: Query[] = [];
  const from = (table: string) => {
    const query: Query = { table, op: "select", filters: {} };
    // Fluent PostgREST double scoped to the operations exercised here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      select: () => chain,
      insert: (values: unknown) => {
        query.op = "insert";
        query.values = values;
        return chain;
      },
      update: (values: unknown) => {
        query.op = "update";
        query.values = values;
        return chain;
      },
      upsert: (values: unknown) => {
        query.op = "insert";
        query.values = values;
        return chain;
      },
      delete: () => {
        query.op = "delete";
        return chain;
      },
      eq: (key: string, value: unknown) => {
        query.filters[key] = value;
        return chain;
      },
      is: (key: string, value: unknown) => {
        query.filters[key] = value;
        return chain;
      },
      gte: () => chain,
      lte: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => {
        calls.push({ ...query, filters: { ...query.filters } });
        return resolve(query);
      },
      single: async () => {
        calls.push({ ...query, filters: { ...query.filters } });
        return resolve(query);
      },
    };
    return chain;
  };
  return { db: { from }, calls };
}

function contexto(
  db: ReturnType<typeof fakeDb>["db"],
  actor: McpContext["actor"] = { type: "user", id: USER, role: "manager" },
): McpContext {
  return {
    organizationId: ORG,
    role: "manager",
    actor,
    apiTokenId: "token-1",
    requestId: "req-1",
    supabase: db as never,
  };
}

describe("MCP Parte 5 — agenda administrativa", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registra nove tools tenant-scoped e cerca a remoção destrutiva", () => {
    expect(AGENDA_ADMIN_MCP_TOOLS).toHaveLength(9);
    expect(new Set(AGENDA_ADMIN_MCP_TOOLS.map((tool) => tool.name)).size).toBe(9);
    expect(crmDeleteAvailabilityException.capabilities).toContain("destructive_operations");
    for (const tool of AGENDA_ADMIN_MCP_TOOLS) {
      expect(Object.keys(tool.inputSchema), tool.name).not.toContain("organization_id");
    }
  });

  it("expõe configuração completa do tipo e sempre filtra a organização", async () => {
    const row = {
      id: ID,
      slot_interval_minutes: 15,
      reminder_extra_offsets_minutes: [1440, 180],
      reminder_template_name: "lembrete-consulta",
      reminder_body: "Lembrete",
      reminder_bodies: { "180": "Em breve" },
    };
    const { db, calls } = fakeDb(() => ({ data: row, error: null }));
    const result = await crmGetEventType.handler(
      { event_type_id: ID, event_type_slug: undefined },
      contexto(db),
    );
    expect(result).toEqual({ tipo: row });
    expect(calls[0]?.filters).toMatchObject({ organization_id: ORG, id: ID });
  });

  it("valida lembretes completos e preserva o slug ao editar", async () => {
    const shape = z.object(crmUpdateEventType.inputSchema);
    expect(
      shape.parse({ event_type_id: ID, reminder_extra_offsets_minutes: [180, 1440, 180] })
        .reminder_extra_offsets_minutes,
    ).toEqual([1440, 180]);
    const { db, calls } = fakeDb(() => ({ data: { id: ID }, error: null }));
    await crmUpdateEventType.handler(
      { event_type_id: ID, reminder_body: "Volte amanhã" },
      contexto(db),
    );
    expect(calls[0]?.op).toBe("update");
    expect(calls[0]?.values).toEqual({ reminder_body: "Volte amanhã" });
    expect(calls[0]?.values).not.toHaveProperty("slug");
    expect(calls[0]?.filters).toMatchObject({ organization_id: ORG, id: ID });
  });

  it("recusa responsável de outro tenant antes de criar tipo", async () => {
    const { db, calls } = fakeDb((query) =>
      query.table === "user_organizations"
        ? { data: null, error: null }
        : { data: { id: ID }, error: null },
    );
    await expect(
      crmCreateEventType.handler(
        {
          name: "Consulta",
          category: "consulta",
          duration_minutes: 30,
          location_kind: "video_link",
          default_owner_user_id: USER,
        },
        contexto(db),
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(calls.some((call) => call.table === "calendar_event_types")).toBe(false);
    expect(calls[0]?.filters).toMatchObject({ organization_id: ORG, user_id: USER });
  });

  it("valida fuso IANA e grava disponibilidade somente para membro do tenant", async () => {
    const shape = z.object(crmUpdateAvailability.inputSchema);
    expect(() =>
      shape.parse({ user_id: USER, schedule: { timezone: "America/Asunción", windows: [] } }),
    ).toThrow();
    const { db, calls } = fakeDb((query) =>
      query.table === "user_organizations"
        ? { data: { user_id: USER }, error: null }
        : {
            data: { user_id: USER, schedule: { timezone: "America/Sao_Paulo", windows: [] } },
            error: null,
          },
    );
    await crmUpdateAvailability.handler(
      { user_id: USER, schedule: { timezone: "America/Sao_Paulo", windows: [] } },
      contexto(db),
    );
    const write = calls.find((call) => call.table === "attendant_availability");
    expect(write?.values).toMatchObject({ organization_id: ORG, user_id: USER });
  });

  it("cria e remove exceções pelo modelo oficial, sempre dentro do tenant", async () => {
    const { db, calls } = fakeDb((query) => {
      if (query.table === "user_organizations") return { data: { user_id: USER }, error: null };
      return { data: { id: ID, exception_date: "2026-10-01" }, error: null };
    });
    await crmCreateAvailabilityException.handler(
      {
        user_id: USER,
        date: "2026-10-01",
        unavailable: true,
        start_minute: 0,
        end_minute: 1440,
        reason: "feriado",
      },
      contexto(db),
    );
    await crmDeleteAvailabilityException.handler({ exception_id: ID }, contexto(db));
    const created = calls.find(
      (call) => call.table === "calendar_availability_exceptions" && call.op === "insert",
    );
    const removed = calls.find(
      (call) => call.table === "calendar_availability_exceptions" && call.op === "delete",
    );
    expect(created?.values).toMatchObject({
      organization_id: ORG,
      user_id: USER,
      exception_date: "2026-10-01",
    });
    expect(removed?.filters).toMatchObject({ organization_id: ORG, id: ID });
  });

  it("preserva confirmação humana quando o ator MCP não pode confirmar presença", async () => {
    const result = (await crmSetAppointmentOutcome.handler(
      { appointment_id: ID, outcome: "completed", notes: undefined },
      contexto({ from: vi.fn() } as never, { type: "api_token", id: "token-1", role: "manager" }),
    )) as { human_confirmation_required: boolean; registrado: boolean };
    expect(result).toMatchObject({ registrado: false, human_confirmation_required: true });
  });
});
