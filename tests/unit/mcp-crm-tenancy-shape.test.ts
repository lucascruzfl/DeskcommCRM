import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("tenancy dos caminhos canônicos usados pelo MCP CRM", () => {
  it("responsável humano do lead exige membership ativo na organização", () => {
    const source = readFileSync("app/api/v1/leads/_handler.ts", "utf8");
    expect(source).toMatch(/from\("user_organizations"\)[\s\S]*eq\("user_id", result\.patch\.owner_user_id\)[\s\S]*eq\("organization_id", ctx\.organization_id\)[\s\S]*is\("revoked_at", null\)/);
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
