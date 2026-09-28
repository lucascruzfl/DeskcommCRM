import { describe, expect, it } from "vitest";
import { fail } from "./wrappers";

describe("fail", () => {
  it("não publica detalhes técnicos em erros de servidor", async () => {
    const response = fail("internal_error", "SQL em host privado", 500, {
      requestId: "req-seguro",
      details: { token: "credencial-privada" },
    });

    expect(response.status).toBe(500);
    expect(response.headers.get("X-Request-Id")).toBe("req-seguro");
    expect(await response.json()).toEqual({
      error: { code: "internal_error", message: "Não foi possível concluir a operação." },
    });
  });

  it("mantém explicação e detalhes de validação em 4xx", async () => {
    const response = fail("validation_failed", "Campo inválido", 422, {
      details: { field: "name" },
    });

    expect(await response.json()).toEqual({
      error: { code: "validation_failed", message: "Campo inválido", details: { field: "name" } },
    });
  });

  it("aceita apenas o nome público de campo como detalhe de 500", async () => {
    const response = fail("internal_error", "SQL privado", 500, {
      details: { motivo: "SQL privado" },
      publicField: "number_activated_at",
    });
    expect(await response.json()).toEqual({
      error: {
        code: "internal_error",
        message: "Não foi possível concluir a operação.",
        details: { field: "number_activated_at" },
      },
    });
  });

  it("preserva progresso e orientação explicitamente públicos sem repassar a causa bruta", async () => {
    const response = fail("internal_error", "SQL privado", 500, {
      details: { erro: "SQL privado" },
      publicMessage: "A rodada falhou; tente de novo.",
      publicDetails: { arquivo_forense: { esvaziadas: 2, apagadas: 0 } },
    });
    expect(await response.json()).toEqual({
      error: {
        code: "internal_error",
        message: "A rodada falhou; tente de novo.",
        details: { arquivo_forense: { esvaziadas: 2, apagadas: 0 } },
      },
    });
  });

  it("mantém orientação explícita de serviço indisponível em 503", async () => {
    const response = fail("upstream_unavailable", "Tente novamente.", 503);
    expect(await response.json()).toEqual({
      error: { code: "upstream_unavailable", message: "Tente novamente." },
    });
  });
});
