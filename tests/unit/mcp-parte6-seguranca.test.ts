import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const raiz = process.cwd();
const ler = (arquivo: string) => fs.readFileSync(path.join(raiz, arquivo), "utf8");

describe("contratos de segurança MCP da Parte 6", () => {
  it("FAQ usa RPC atômica tanto no MCP quanto na rota HTTP", () => {
    for (const arquivo of [
      "lib/mcp/tools/knowledge-administracao.ts",
      "app/api/v1/ai/knowledge/sources/[id]/route.ts",
    ])
      expect(ler(arquivo)).toContain("fn_replace_knowledge_faq_items");
    expect(ler("app/api/v1/ai/knowledge/sources/[id]/route.ts")).not.toContain(
      "PATCH delete items failed",
    );
  });

  it("migration valida antes de apagar e fecha EXECUTE público", () => {
    const sql = ler("supabase/migrations/20260921092259_0382_replace_faq_atomico.sql");
    expect(sql.indexOf("knowledge_faq_invalid_item")).toBeLessThan(
      sql.indexOf("delete from public.ai_faq_items"),
    );
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role");
  });

  it("projeções de integrações omitem colunas de credencial", () => {
    const fonte = ler("lib/mcp/tools/webhooks-integracoes-canais.ts");
    const projection =
      fonte.match(/from\("tenant_integrations"\)[\s\S]{0,400}?\.eq\("organization_id"/)?.[0] ?? "";
    for (const segredo of [
      "access_token_encrypted",
      "refresh_token_encrypted",
      "client_secret",
      "api_key",
    ])
      expect(projection).not.toContain(segredo);
  });

  it("equipe bloqueia autoalteração e administradores", () => {
    const fonte = ler("lib/mcp/tools/equipe-administracao.ts");
    expect(fonte).toContain("i.member_id === c.provisionedByUserId");
    expect(fonte).toContain('target.role === "admin"');
    expect(fonte).toContain('z.enum(["viewer", "agent", "manager"])');
    expect(fonte).toContain('.eq("user_id", ctx.provisionedByUserId!)');
    expect(fonte).toContain('.eq("role", "admin")');
  });

  it("indexação apenas emite evento para o worker oficial", () => {
    const fonte = ler("lib/mcp/tools/knowledge-administracao.ts");
    expect(fonte).toContain('p_event_type: "knowledge_source.updated"');
    expect(fonte).not.toContain("embedMany");
    expect(fonte).not.toContain("generateEmbedding");
  });
});
