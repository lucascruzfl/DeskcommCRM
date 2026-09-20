import { describe, expect, it } from "vitest";

import { validarValoresDeCampos } from "./custom-field-values";

const settings = {
  fields: [
    { key: "nome", label: "Nome", type: "text" },
    { key: "score", label: "Score", type: "number" },
    { key: "ativo", label: "Ativo", type: "boolean" },
    { key: "data", label: "Data", type: "date" },
    { key: "origem", label: "Origem", type: "select", options: [{ value: "site", label: "Site" }] },
    { key: "interesses", label: "Interesses", type: "multiselect", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
    { key: "obrigatorio", label: "Obrigatório", type: "text", required: true },
  ],
};

describe("valores de campos personalizados", () => {
  it("valida todos os tipos reais usados pelo funil", () => {
    expect(validarValoresDeCampos(settings, {
      nome: "Ana", score: 10, ativo: true, data: "2026-09-20", origem: "site", interesses: ["a", "b"],
    }, [])).toEqual({ nome: "Ana", score: 10, ativo: true, data: "2026-09-20", origem: "site", interesses: ["a", "b"] });
  });

  it("recusa tipo e opção inválidos", () => {
    expect(() => validarValoresDeCampos(settings, { score: "dez" }, [])).toThrow();
    expect(() => validarValoresDeCampos(settings, { origem: "telefone" }, [])).toThrow();
    expect(() => validarValoresDeCampos(settings, { interesses: ["c"] }, [])).toThrow();
  });

  it("limpa campo opcional e preserva obrigatório", () => {
    expect(validarValoresDeCampos(settings, {}, ["nome"])).toEqual({ nome: null });
    expect(() => validarValoresDeCampos(settings, {}, ["obrigatorio"])).toThrow(/required/);
  });

  it("recusa chave não declarada no funil", () => {
    expect(() => validarValoresDeCampos(settings, { segredo: "x" }, [])).toThrow(/not_defined/);
  });
});
