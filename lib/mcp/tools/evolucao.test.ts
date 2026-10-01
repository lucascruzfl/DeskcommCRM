import { describe, expect, it, vi } from "vitest";
import { catalogEntry } from "./catalog";
import { crmGetOrgMemory, crmSaveOrgMemory } from "./evolucao";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const input = { titulo: "Regra aprovada", corpo: "Não confirmar cobertura sem endereço completo." };

describe("crm_save_org_memory — origem da regra", () => {
  function context(actor: { type: string; id: string }, provisionedByUserId?: string) {
    const query = {
      insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "entry" }, error: null }),
    };
    return { organizationId: ORG, actor, provisionedByUserId,
      supabase: { from: vi.fn(() => query) }, query };
  }

  it("regra confirmada pelo operador no token fica manual e atribuída à pessoa", async () => {
    const ctx = context({ type: "api_token", id: "token" }, USER);
    await crmSaveOrgMemory.handler(input, ctx as never);
    expect(ctx.query.insert).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: ORG, source: "manual", created_by: USER,
    }));
    expect(crmSaveOrgMemory.redigirParaAuditoria?.(input)).toEqual({
      titulo_present: true, corpo_length: input.corpo.length,
    });
    expect(crmSaveOrgMemory.requiresRole).toBe("manager");
  });

  it("manager humano pode registrar regra com origem manual e sua autoria", async () => {
    const ctx = context({ type: "user", id: USER });
    await expect(crmSaveOrgMemory.handler(input, ctx as never)).resolves.toEqual({ anotacao: { id: "entry" } });
    expect(ctx.query.insert).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: ORG, source: "manual", created_by: USER,
    }));
    expect(crmSaveOrgMemory.requiresRole).toBe("manager");
  });

  it("ator de IA não ganha escrita administrativa mesmo se invocar o handler diretamente", async () => {
    const ctx = context({ type: "ai_agent", id: "run" });
    await expect(crmSaveOrgMemory.handler(input, ctx as never))
      .rejects.toThrow("org_memory_write_requires_person");
    expect(ctx.supabase.from).not.toHaveBeenCalled();
  });

  it("leitura da memória permanece disponível ao agente", () => {
    expect(crmGetOrgMemory.requiresRole).toBe("agent");
    expect(catalogEntry("crm_get_org_memory")?.apenasHumano).not.toBe(true);
    expect(catalogEntry("crm_save_org_memory")?.apenasHumano).toBe(true);
  });
});
