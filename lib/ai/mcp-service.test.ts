import { describe, expect, it } from "vitest";

import {
  getAiCredential,
  getAiModel,
  listAiCredentials,
  listAiModels,
  validateAiConfiguration,
} from "./mcp-service";

type Result = { data: unknown; error: { message: string } | null };

function fakeDb(rows: Record<string, unknown[]>) {
  const filters: Array<[string, string, unknown]> = [];
  return {
    filters,
    from(table: string) {
      let current = [...(rows[table] ?? [])] as Array<Record<string, unknown>>;
      let selected: string[] | null = null;
      const output = () => selected
        ? current.map((row) => Object.fromEntries(
          selected!.filter((column) => column in row).map((column) => [column, row[column]]),
        ))
        : current;
      const builder = {
        select(columns: string) {
          selected = columns.split(",").map((column) => column.trim());
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        eq(column: string, value: unknown) {
          filters.push([table, column, value]);
          current = current.filter((row) => row[column] === value);
          return builder;
        },
        is(column: string, value: unknown) {
          current = current.filter((row) => row[column] === value);
          return builder;
        },
        async maybeSingle(): Promise<Result> { return { data: output()[0] ?? null, error: null }; },
        then(resolve: (result: Result) => unknown) { return Promise.resolve(resolve({ data: output(), error: null })); },
      };
      return builder;
    },
  };
}

const model = {
  id: "modelo-1", provider: "openai", model_id: "gpt-test", display_name: "GPT Test",
  description: null, context_window: 1000, supports_tools: true, supports_vision: false,
  is_default_for_provider: false, deprecated_at: null, released_at: null,
  input_price_per_million_cents: 1, output_price_per_million_cents: 2,
};
const credential = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", organization_id: "org-a", provider: "openai",
  label: "Principal", api_key_last4: "1234", validated_at: "2026-01-01T00:00:00Z",
  validation_error: null, models_available: ["gpt-test"], is_active: true,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
};

describe("serviço MCP de IA", () => {
  it("lista e filtra modelos reais por provider", async () => {
    const db = fakeDb({ ai_models: [model, { ...model, id: "2", provider: "google" }] });
    await expect(listAiModels(db as never, { provider: "openai" })).resolves.toEqual([model]);
  });

  it("distingue modelo inexistente e depreciado", async () => {
    const missing = fakeDb({ ai_models: [] });
    await expect(getAiModel(missing as never, "openai", "nao-existe"))
      .rejects.toMatchObject({ code: "model_not_found" });
    const old = fakeDb({ ai_models: [{ ...model, deprecated_at: "2025-01-01T00:00:00Z" }],
      ai_provider_credentials_safe: [credential] });
    await expect(validateAiConfiguration(old as never, "org-a", {
      provider: "openai", model: "gpt-test", credential_id: credential.id,
    })).rejects.toMatchObject({ code: "model_deprecated" });
  });

  it("nunca seleciona ou devolve valor secreto de credencial", async () => {
    const db = fakeDb({ ai_provider_credentials_safe: [{
      ...credential,
      api_key: "API_KEY_REAL",
      token: "TOKEN_REAL",
      secret: "SECRET_REAL",
      api_key_ciphertext: "CIPHERTEXT_REAL",
      credential_value: "CREDENTIAL_REAL",
      refresh_token: "REFRESH_REAL",
      client_secret: "CLIENT_REAL",
    }] });
    const result = await listAiCredentials(db as never, "org-a");
    for (const field of [
      "api_key",
      "token",
      "secret",
      "api_key_ciphertext",
      "credential_value",
      "refresh_token",
      "client_secret",
    ]) expect(result[0]).not.toHaveProperty(field);
    expect(JSON.stringify(result)).not.toMatch(/API_KEY_REAL|TOKEN_REAL|SECRET_REAL|CIPHERTEXT_REAL|CREDENTIAL_REAL|REFRESH_REAL|CLIENT_REAL/);
  });

  it("nega credencial de outra organização pela própria consulta", async () => {
    const db = fakeDb({ ai_provider_credentials_safe: [{ ...credential, organization_id: "org-b" }] });
    await expect(getAiCredential(db as never, "org-a", credential.id))
      .rejects.toMatchObject({ code: "credential_not_found" });
    expect(db.filters).toContainEqual(["ai_provider_credentials_safe", "organization_id", "org-a"]);
  });

  it("faz preflight válido e acusa credencial inexistente", async () => {
    const db = fakeDb({ ai_models: [model], ai_provider_credentials_safe: [credential] });
    await expect(validateAiConfiguration(db as never, "org-a", {
      provider: "openai", model: "gpt-test", credential_id: credential.id, requires_tools: true,
    })).resolves.toMatchObject({ valid: true, provider: "openai", model: "gpt-test" });

    const noCredential = fakeDb({ ai_models: [model], ai_provider_credentials_safe: [] });
    await expect(validateAiConfiguration(noCredential as never, "org-a", {
      provider: "openai", model: "gpt-test", credential_id: credential.id,
    })).rejects.toMatchObject({ code: "credential_not_found" });
  });

  it("rejeita incompatibilidade de capability", async () => {
    const db = fakeDb({ ai_models: [{ ...model, supports_tools: false }], ai_provider_credentials_safe: [credential] });
    await expect(validateAiConfiguration(db as never, "org-a", {
      provider: "openai", model: "gpt-test", credential_id: credential.id, requires_tools: true,
    })).rejects.toMatchObject({ code: "model_incompatible" });
  });
});
