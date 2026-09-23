import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent-engine/agent/skills", () => ({ setSkillPointer: vi.fn() }));
vi.mock("@/lib/ai/skills/db", () => ({ getSkillsPool: vi.fn(() => ({})) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { setSkillPointer } from "@/lib/agent-engine/agent/skills";
import { audit } from "@/lib/audit";
import type { McpContext } from "@/lib/mcp/types";
import { crmRestoreAiSkillVersion } from "./skill-versions";

const org = "11111111-1111-4111-8111-111111111111";
const version = "22222222-2222-4222-8222-222222222222";

function context(found: boolean) {
  const filters: Array<[string, unknown]> = [];
  const query = {
    select: () => query,
    eq: (key: string, value: unknown) => {
      filters.push([key, value]);
      return query;
    },
    maybeSingle: async () => ({ data: found ? { id: version } : null, error: null }),
  };
  const ctx = {
    organizationId: org,
    actor: { type: "api_token", id: "token", role: "manager" },
    apiTokenId: "token",
    provisionedByUserId: "33333333-3333-4333-8333-333333333333",
    requestId: "request",
    supabase: { from: () => query },
  } as unknown as McpContext;
  return { ctx, filters };
}

beforeEach(() => vi.clearAllMocks());

describe("restauração de skill MCP", () => {
  it("recusa versão de outra organização antes de mover o ponteiro", async () => {
    const { ctx, filters } = context(false);
    await expect(crmRestoreAiSkillVersion.handler({ name: "atendimento", version_id: version }, ctx))
      .rejects.toMatchObject({ status: 404 });
    expect(filters).toContainEqual(["organization_id", org]);
    expect(filters).toContainEqual(["name", "atendimento"]);
    expect(setSkillPointer).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("usa o serviço canônico e registra a versão restaurada", async () => {
    const { ctx } = context(true);
    const result = await crmRestoreAiSkillVersion.handler({ name: "atendimento", version_id: version }, ctx);
    expect(setSkillPointer).toHaveBeenCalledWith(expect.anything(), {
      tenantId: org, name: "atendimento", versionId: version,
    });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: org, resourceId: version, action: "ai.skill_restored",
    }));
    expect(result).toEqual({ name: "atendimento", version_id: version });
  });
});
