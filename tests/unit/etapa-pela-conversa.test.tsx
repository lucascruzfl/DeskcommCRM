import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextRequest } from "next/server";

import { CRMSidePanel } from "@/components/inbox/CRMSidePanel";
import { createClient } from "@/lib/supabase/server";

/**
 * MOVER O NEGÓCIO DE ETAPA SEM SAIR DA CONVERSA.
 *
 * Medido numa loja que vende pelo WhatsApp (26/09/2026): o cliente confirmava o
 * pedido na conversa e, para passar o negócio a "Pedido confirmado", quem
 * atendia tinha de sair do Inbox, abrir o quadro, achar o card e arrastá-lo. O
 * painel mostrava "Funil · Etapa" e não deixava mudar.
 *
 * O que estes casos guardam, e por que cada um:
 *
 *  1. **A rota devolve a etapa atual e as etapas ATIVAS, na ordem do quadro.**
 *     Sem `stage_id` o seletor não sabe onde o negócio está; com etapa
 *     arquivada na lista, a tela ofereceria um destino que o quadro não mostra.
 *     O dublê serve o embed da fixture com ou sem o `select` pedi-lo, então a
 *     string do `select` é espionada — senão apagar o embed deixaria isto verde.
 *  2. **O seletor move pelo MESMO caminho do "Mover para…" do quadro**
 *     (`/api/v1/leads/bulk`, ação `move`): é ele que grava atividade, evento e
 *     auditoria. Um PATCH direto no lead moveria o card sem nada disso, e a
 *     etapa que avisa na Central deixaria de avisar quando movida pela conversa.
 *  3. **Etapa de perda não é oferecida** — ela pede motivo, e esse diálogo mora
 *     no quadro. Oferecê-la aqui seria perder sem motivo.
 *  4. **Resposta antiga (sem as etapas) não desenha seletor vazio.**
 */

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/users/nome-do-atendente", () => ({ nomesDosAtendentes: async () => new Map() }));

const ORG = "org-1";
const CONTATO = "c0000000-0000-4000-8000-000000000001";

type Linha = Record<string, unknown>;

function valor(linha: Linha, caminho: string): unknown {
  return caminho.split(".").reduce<unknown>((acc, parte) => (acc as Linha | null)?.[parte], linha);
}

function bancoFalso(tabelas: Record<string, Linha[]>) {
  const selects: string[] = [];
  const from = (tabela: string) => {
    let linhas = [...(tabelas[tabela] ?? [])];
    let limite = Infinity;
    const chain = {
      select: (cols: string) => (selects.push(cols), chain),
      in: (col: string, values: unknown[]) => (
        (linhas = linhas.filter((l) => values.includes(valor(l, col)))),
        chain
      ),
      eq: (col: string, val: unknown) => (
        (linhas = linhas.filter((l) => valor(l, col) === val)),
        chain
      ),
      is: (col: string, val: unknown) => (
        (linhas = linhas.filter((l) => (valor(l, col) ?? null) === val)),
        chain
      ),
      not: (col: string, _op: string, val: unknown) => (
        (linhas = linhas.filter((l) => (valor(l, col) ?? null) !== val)),
        chain
      ),
      order: () => chain,
      limit: (n: number) => ((limite = n), chain),
      maybeSingle: async () => ({ data: linhas[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: linhas.slice(0, limite), error: null }).then(res),
    };
    return chain;
  };
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u-1" } }, error: null }) },
    from,
    selects,
  };
}

describe("crm-summary: a etapa do negócio e as etapas do funil", () => {
  it("devolve stage_id e as etapas ativas na ordem do quadro", async () => {
    const banco = bancoFalso({
      contacts: [{ id: CONTATO, organization_id: ORG }],
      operational_crm_pipelines: [
        { id: "p-1", organization_id: ORG, name: "Pedidos", settings: {}, is_archived: false },
      ],
      operational_crm_stages: [
        {
          id: "s-cancelado",
          pipeline_id: "p-1",
          organization_id: ORG,
          name: "Cancelado",
          position: 3000,
          is_won: false,
          is_lost: true,
          is_archived: false,
        },
        {
          id: "s-velha",
          pipeline_id: "p-1",
          organization_id: ORG,
          name: "Etapa antiga",
          position: 1500,
          is_won: false,
          is_lost: false,
          is_archived: true,
        },
        {
          id: "s-confirmado",
          pipeline_id: "p-1",
          organization_id: ORG,
          name: "Pedido confirmado",
          position: "2000",
          is_won: false,
          is_lost: false,
          is_archived: false,
        },
        {
          id: "s-dados",
          pipeline_id: "p-1",
          organization_id: ORG,
          name: "Dados incompletos",
          position: 1000,
          is_won: false,
          is_lost: false,
          is_archived: false,
        },
      ],
      crm_leads: [
        {
          id: "l-1",
          organization_id: ORG,
          contact_id: CONTATO,
          title: "Pedido",
          status: "open",
          value_cents: null,
          currency: null,
          updated_at: "2026-09-26T12:00:00.000Z",
          pipeline_id: "p-1",
          stage_id: "s-dados",
          custom_fields: {},
        },
      ],
    });
    vi.mocked(createClient).mockResolvedValue(banco as never);

    const { GET } = await import("@/app/api/v1/contacts/[id]/crm-summary/route");
    const res = await GET(new NextRequest(`http://x/api/v1/contacts/${CONTATO}/crm-summary`), {
      params: Promise.resolve({ id: CONTATO }),
    });
    const body = (await res.json()) as { data: { leads: Linha[] } };

    expect(res.status).toBe(200);
    const [lead] = body.data.leads;
    expect(lead?.stage_id).toBe("s-dados");
    expect(lead?.etapas_do_funil).toEqual([
      { id: "s-dados", name: "Dados incompletos", is_won: false, is_lost: false },
      { id: "s-confirmado", name: "Pedido confirmado", is_won: false, is_lost: false },
      { id: "s-cancelado", name: "Cancelado", is_won: false, is_lost: true },
    ]);
    const select = banco.selects.join("|");
    expect(select).toContain("stage_id");
    expect(select).toContain("id, pipeline_id, name, position, is_won, is_lost, is_archived");
    expect(select).not.toContain("crm_pipelines!inner");
  });
});

// ---- o seletor no painel da conversa ----

// O Select do Radix pede estas APIs do navegador, que o jsdom não tem.
window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
window.HTMLElement.prototype.setPointerCapture = vi.fn();
window.HTMLElement.prototype.releasePointerCapture = vi.fn();

const get = vi.fn();
const post = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    patch: vi.fn(),
  },
}));
vi.mock("@/hooks/pipelines/useDefaultPipeline", () => ({
  useDefaultPipeline: () => ({ data: null, isError: false }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock("@/hooks/inbox/useConversationTags", () => ({
  useUpdateConversationTags: () => ({ mutate: vi.fn(), isPending: false }),
  useConversationTagVocabulary: () => ({ data: [] }),
}));
vi.mock("@/hooks/contacts/useContactTagVocabulary", () => ({
  useContactTagVocabulary: () => ({ data: [] }),
}));
vi.mock("@/hooks/contacts/useUpdateContact", () => ({
  useUpdateContact: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/auth/AuthProvider", () => ({ useAuth: () => ({ user: { support: null } }) }));
vi.mock("@/components/contacts/RoteirosDoContato", () => ({ RoteirosDoContato: () => null }));

const conversation = {
  id: "cv-1",
  organization_id: ORG,
  contact_id: CONTATO,
  tags: [],
  contacts: { id: CONTATO, display_name: "Fulana", name: null, phone_number: "5511999", tags: [] },
} as unknown as React.ComponentProps<typeof CRMSidePanel>["conversation"];

const ETAPAS = [
  { id: "s-dados", name: "Dados incompletos", is_won: false, is_lost: false },
  { id: "s-confirmado", name: "Pedido confirmado", is_won: false, is_lost: false },
  { id: "s-entregue", name: "Entregue", is_won: true, is_lost: false },
  { id: "s-cancelado", name: "Cancelado", is_won: false, is_lost: true },
];

function resumo(lead: Linha) {
  return {
    data: {
      leads: [
        {
          id: "l-1",
          title: "Pedido",
          status: "open",
          value_cents: null,
          currency: null,
          updated_at: "2026-09-26T12:00:00Z",
          pipeline_id: "p-1",
          custom_fields: {},
          field_defs: [],
          funil_nome: "Pedidos",
          etapa_nome: "Dados incompletos",
          ...lead,
        },
      ],
      orders: [],
      activities: [],
      demandas: [],
    },
  };
}

function renderPainel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CRMSidePanel conversation={conversation} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  post.mockResolvedValue({ data: { updated_count: 1 } });
});

describe("painel da conversa — Etapa do funil", () => {
  it("move pelo mesmo caminho do quadro, sem oferecer etapa de perda, e relê o resumo", async () => {
    get.mockResolvedValue(resumo({ stage_id: "s-dados", etapas_do_funil: ETAPAS }));
    renderPainel();
    const user = userEvent.setup();

    const seletor = await screen.findByRole("combobox", { name: "Etapa do funil" });
    expect(seletor.textContent).toContain("Dados incompletos");

    await user.click(seletor);
    const opcoes = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(opcoes).toEqual(["Dados incompletos", "Pedido confirmado", "Entregue"]);

    const leiturasAntes = get.mock.calls.length;
    await user.click(screen.getByRole("option", { name: "Pedido confirmado" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/v1/leads/bulk", {
        action: "move",
        lead_ids: ["l-1"],
        params: { stage_id: "s-confirmado" },
      }),
    );
    // A tela relê o resumo: seletor e "Funil · Etapa" dizem a etapa nova.
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(leiturasAntes));
  });

  it("escolher a etapa em que o negócio já está não chama a rota", async () => {
    get.mockResolvedValue(resumo({ stage_id: "s-dados", etapas_do_funil: ETAPAS }));
    renderPainel();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("combobox", { name: "Etapa do funil" }));
    await user.click(await screen.findByRole("option", { name: "Dados incompletos" }));
    expect(post).not.toHaveBeenCalled();
  });

  it("recusa da rota (ex.: campos obrigatórios da etapa) não diz que atualizou", async () => {
    const { toast } = await import("sonner");
    vi.mocked(toast.success).mockClear();
    post.mockRejectedValue(
      Object.assign(new Error("Preencha os campos obrigatórios antes de continuar: CPF."), {
        code: "required_fields_missing",
        status: 422,
      }),
    );
    get.mockResolvedValue(resumo({ stage_id: "s-dados", etapas_do_funil: ETAPAS }));
    renderPainel();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("combobox", { name: "Etapa do funil" }));
    await user.click(await screen.findByRole("option", { name: "Pedido confirmado" }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Etapa do funil" })).not.toBeDisabled(),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "Etapa do funil" }).textContent).toContain(
      "Dados incompletos",
    );
  });

  it("resposta sem as etapas do funil não desenha seletor vazio", async () => {
    get.mockResolvedValue(resumo({}));
    renderPainel();

    // Guarda de vacuidade: o bloco do negócio desenhou — o seletor é que não.
    await waitFor(() =>
      expect(screen.getByTestId("inbox-campos-lead").textContent).toContain("Pedidos"),
    );
    expect(screen.queryByTestId("inbox-etapa-do-negocio")).toBeNull();
  });
});
