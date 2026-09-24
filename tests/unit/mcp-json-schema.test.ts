import { describe, expect, it } from "vitest";
import { z } from "zod";

import { allTools } from "@/lib/mcp/tools";

describe("catálogo MCP para a tela do agente", () => {
  it("serializa o schema de entrada de cada tool como OpenAPI JSON Schema", () => {
    const invalidos: string[] = [];
    for (const tool of allTools) {
      try {
        z.toJSONSchema(z.object(tool.inputSchema), { target: "openapi-3.0", io: "input" });
      } catch (error) {
        invalidos.push(`${tool.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    expect(invalidos).toEqual([]);
  });
});
