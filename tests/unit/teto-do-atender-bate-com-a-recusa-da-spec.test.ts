/**
 * A recusa do pacote é verificada com o mesmo seed da E2E.
 * O catálogo MCP cresce entre releases: o cenário deve recusar o primeiro
 * clique, informar quantas vagas faltam e aceitar depois de liberá-las.
 * Nenhuma contagem fixa de ferramentas representa esse contrato.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { TOOL_CATALOG, deModuloDesligado } from "@/lib/mcp/tools/catalogo";
import { IDS_DO_HARNESS } from "@/lib/mcp/tools/ferramentas-do-harness";
import {
  TETO_TOOLS_POR_AGENTE,
  vagasExigidasPeloPacote,
} from "@/lib/mcp/tools/selecao-por-pacote";

const SPEC_DA_E2E = join(process.cwd(), "tests/e2e/capacidades-do-agente.spec.ts");

/**
 * O seed lido do ARQUIVO, não importado: a spec roda `loadCreds()` no corpo do
 * módulo (spawna scripts de seed) e importá-la aqui levaria o e2e inteiro para
 * dentro do unitário. O contrato é o `const TOOLS_DO_SEED = [...]` — se
 * renomearem a constante, este teste reprova e a pessoa atualiza os dois juntos.
 */
function toolsDoSeedDaSpec(): string[] {
  const texto = readFileSync(SPEC_DA_E2E, "utf8");
  const bloco = texto.match(/const TOOLS_DO_SEED = \[([\s\S]*?)\];/);
  if (!bloco?.[1]) {
    throw new Error(
      "const TOOLS_DO_SEED não existe mais em tests/e2e/capacidades-do-agente.spec.ts. " +
        "Este teste lê o seed de lá de propósito — atualize os dois juntos.",
    );
  }
  // Só as entradas `"crm_...",` em linha própria; os comentários dentro do
  // bloco começam com `//` e não casam.
  return [...bloco[1].matchAll(/^\s*"([^"]+)",?\s*$/gm)].map((m) => m[1]!);
}

/**
 * O catálogo COMO A TELA O VÊ, não o dado cru.
 *
 * A rota `/api/v1/mcp/tools` serve `marcavel: false` para o que é do harness
 * (`catalogo-servido.ts`), e é a lista servida que o `ToolPicker` soma: o
 * `crm_send_whatsapp_message` é crítica de "atender" no arquivo do catálogo,
 * mas o motor a descarta e a tela não a oferece — contar o dado cru daria 27 e
 * acusaria uma recusa que a tela não mostra. As outras duas metades da junção
 * já têm dono: entrada × handler em `catalogo-servido.test.ts`, e a lista de
 * harness em `capacidade-do-harness-nao-e-oferecida.test.ts`.
 */
const CATALOGO_DA_TELA = TOOL_CATALOG.filter(
  // A spec roda numa instalação nova, sem módulo opcional instalado: a rota
  // tira do catálogo servido o que é de módulo desligado (`deModuloDesligado`),
  // e as capacidades de honorários (#1578) não entram na conta da tela.
  (entrada) => !deModuloDesligado(entrada.name, []),
).map((entrada) => ({
  ...entrada,
  marcavel: !IDS_DO_HARNESS.has(entrada.name),
}));

const SEED = toolsDoSeedDaSpec();
const EM_ATENDER = CATALOGO_DA_TELA.filter((c) => c.pacotes.includes("atender")).map(
  (c) => c.name,
);

describe("ligar Atender com o seed da spec excede o teto e cabe depois de liberar as vagas", () => {
  it("leu o seed da spec (guarda de vacuidade)", () => {
    // Um seed vazio faria a conta abaixo medir só o pacote — verde sobre nada.
    expect(SEED.length, "o seed da spec foi lido vazio").toBeGreaterThan(0);
    expect(EM_ATENDER.length, "o pacote 'atender' sumiu do catálogo").toBeGreaterThan(0);
  });

  it("cada ferramenta do seed existe no catálogo", () => {
    const nomes = new Set(CATALOGO_DA_TELA.map((c) => c.name));
    for (const ferramenta of SEED) {
      expect(
        nomes.has(ferramenta),
        `o seed cita "${ferramenta}", que o catálogo não tem — spec e catálogo andaram separados`,
      ).toBe(true);
    }
  });

  it("nenhuma ferramenta do seed está DENTRO de Atender", () => {
    // Liberar uma ferramenta do seed precisa liberar uma vaga do pacote.
    for (const ferramenta of SEED) {
      expect(
        EM_ATENDER.includes(ferramenta),
        `o seed tem "${ferramenta}" DENTRO de "atender": a soma seed+pacote não é mais a união`,
      ).toBe(false);
    }
  });

  it("recusa primeiro e cabe após liberar exatamente o excedente", () => {
    const exigidas = vagasExigidasPeloPacote(SEED, CATALOGO_DA_TELA, "atender");
    const excedente = exigidas - TETO_TOOLS_POR_AGENTE;
    expect(excedente, "o cenário precisa exercer a recusa").toBeGreaterThan(0);
    expect(excedente, "a pessoa precisa conseguir liberar as vagas pelo seed").toBeLessThanOrEqual(SEED.length);
    const restantes = SEED.slice(excedente);
    expect(vagasExigidasPeloPacote(restantes, CATALOGO_DA_TELA, "atender")).toBe(TETO_TOOLS_POR_AGENTE);
  });
});
