import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("tenancy dos caminhos canônicos usados pelo MCP CRM", () => {
  it("responsável humano do lead exige membership ativo na organização", () => {
    const source = readFileSync("app/api/v1/leads/_handler.ts", "utf8");
    // O upstream valida pelo admin porque RLS esconde colegas do atendente.
    // Atribuição nova exige org, vínculo ativo e papel; reenviar o dono atual
    // é edição, coberta pelo teste comportamental lead-so-liga-contato-… .
    expect(source).toContain("const responsavel = result.patch.owner_user_id");
    expect(source).toContain("responsavel !== null && responsavel !== responsavelAtual");
    expect(source).toMatch(/createAdminClient\(\)[\s\S]*from\("user_organizations"\)[\s\S]*eq\("organization_id", ctx\.organization_id\)[\s\S]*eq\("user_id", responsavel\)[\s\S]*is\("revoked_at", null\)/);
    expect(source).toContain('!membro || membro.role === "viewer"');
  });

  it("serviços novos filtram toda referência pela organização do contexto", () => {
    for (const path of ["lib/pipelines/operations.ts", "lib/tarefas/operations.ts"]) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toMatch(/organization_id\s*:\s*input\./);
      expect(source, path).toContain("organizationId");
      expect(source, path).toContain('.eq("organization_id", ctx.organizationId)');
    }
  });

  it("API e MCP reutilizam o mesmo serviço de troca entre pipelines", () => {
    const route = readFileSync("app/api/v1/leads/[id]/clone/route.ts", "utf8");
    const tools = readFileSync("lib/mcp/tools/leads.ts", "utf8");
    expect(route).toContain("moverLeadParaOutroFunil(");
    expect(tools).toContain("moverLeadParaOutroFunil(");
  });
});
