import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * "Leads recentes" do painel do Inbox mostrava lead de funil ARQUIVADO (issue #943).
 * Arquivar só marca `crm_pipelines.is_archived`; o lead segue `open` e a rota
 * `crm-summary` o devolvia como qualquer outro. Mesma causa do Radar (#940).
 *
 * O filtro de funis ativos vem da projeção operacional e entra no SELECT de
 * leads ANTES do `limit(3)`. O dublê aplica esse filtro para guardar a ordem.
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
  /**
   * Sequência de chamadas POR TABELA. Uma trilha global não serviria: as três
   * consultas da rota são montadas no mesmo `Promise.all`, uma depois da outra,
   * então o `.eq` de `orders` cairia DEPOIS do `.limit` de `crm_leads` e a
   * asserção de ordem falharia sem nenhum defeito no código.
   */
  const trilhas: Record<string, string[]> = {};
  const from = (tabela: string) => {
    const trilha = (trilhas[tabela] ??= []);
    let linhas = [...(tabelas[tabela] ?? [])];
    let limite = Infinity;
    const chain = {
      select: (cols: string) => (selects.push(cols), trilha.push("select"), chain),
      eq: (col: string, val: unknown) => (
        (linhas = linhas.filter((l) => valor(l, col) === val)),
        trilha.push("eq"),
        chain
      ),
      in: (col: string, vals: unknown[]) => (
        (linhas = linhas.filter((l) => vals.includes(valor(l, col)))),
        trilha.push("in"),
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
      limit: (n: number) => ((limite = n), trilha.push("limit"), chain),
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
    trilhas,
  };
}

function lead(id: string): Linha {
  return {
    id,
    organization_id: ORG,
    contact_id: CONTATO,
    title: "Felipe",
    status: "open",
    value_cents: null,
    currency: null,
    updated_at: "2026-09-15T12:00:00.000Z",
    pipeline_id: `p-${id}`,
    stage_id: "stage-novo",
    custom_fields: {},
  };
}

describe("crm-summary: leads recentes", () => {
  it("não devolve lead de funil arquivado e diz funil e etapa dos outros", async () => {
    const banco = bancoFalso({
      contacts: [{ id: CONTATO, organization_id: ORG }],
      operational_crm_pipelines: [
        {
          id: "p-lead-ativo",
          organization_id: ORG,
          name: "GMN Advogados",
          settings: { fields: [] },
          is_archived: false,
        },
      ],
      operational_crm_stages: [{ id: "stage-novo", organization_id: ORG, name: "Novo" }],
      crm_leads: [lead("lead-arquivado"), lead("lead-ativo")],
    });
    vi.mocked(createClient).mockResolvedValue(banco as never);

    const { GET } = await import("@/app/api/v1/contacts/[id]/crm-summary/route");
    const res = await GET(new NextRequest(`http://x/api/v1/contacts/${CONTATO}/crm-summary`), {
      params: Promise.resolve({ id: CONTATO }),
    });
    const body = (await res.json()) as { data: { leads: Linha[] } };

    expect(res.status).toBe(200);
    expect(body.data.leads.map((l) => [l.id, l.funil_nome, l.etapa_nome])).toEqual([
      ["lead-ativo", "GMN Advogados", "Novo"],
    ]);
    expect(banco.selects.join("|")).not.toContain("crm_pipelines!inner");
    expect(banco.trilhas.operational_crm_stages).toContain("select");
    // Filtrar NO BANCO, antes do `limit(3)`, é a metade que o comentário da
    // rota declara — e que nenhuma asserção sobre o RESULTADO alcança, porque
    // com dois leads os dois arranjos devolvem a mesma lista. Mover o `.eq` do
    // funil arquivado para depois do `.limit` faria a rota pedir os 3 mais
    // recentes e SÓ ENTÃO descartar os arquivados: quem tem lead velho em funil
    // arquivado veria a lista encolher em vez de completar.
    const trilha = banco.trilhas.crm_leads ?? [];
    expect(trilha.indexOf("in")).toBeLessThan(trilha.indexOf("limit"));
  });
});
