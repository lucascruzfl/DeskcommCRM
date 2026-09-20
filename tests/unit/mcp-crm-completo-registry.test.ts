import { describe, expect, it } from "vitest";
import { z } from "zod";

import { MCP_REGISTRY, MCP_TOOL_COUNT } from "@/lib/mcp/registry";

const NOVAS = [
  "crm_create_contact",
  "crm_update_contact",
  "crm_get_contact_timeline",
  "crm_delete_contact",
  "crm_get_lead_timeline",
  "crm_move_lead_pipeline",
  "crm_get_pipeline",
  "crm_create_pipeline",
  "crm_update_pipeline",
  "crm_archive_pipeline",
  "crm_update_pipeline_schema",
  "crm_set_custom_field_values",
  "crm_list_tasks",
  "crm_get_task",
  "crm_create_task",
  "crm_update_task",
  "crm_delete_task",
  "crm_list_tag_vocabulary",
  "crm_update_tag",
  "crm_merge_or_delete_tag",
] as const;

const registry = new Map(MCP_REGISTRY.map((tool) => [tool.name, tool]));

describe("registry MCP do CRM completo", () => {
  it("deriva 118 tools e preserva as 20 do CRM comercial sem duplicidade", () => {
    expect(MCP_TOOL_COUNT).toBe(118);
    expect(new Set(MCP_REGISTRY.map((tool) => tool.name)).size).toBe(118);
    for (const name of NOVAS) expect(registry.has(name), name).toBe(true);
  });

  it("nenhuma entrada pública aceita organization_id", () => {
    for (const name of NOVAS)
      expect(Object.keys(registry.get(name)!.inputSchema), name).not.toContain("organization_id");
  });

  it("toda mutação nova declara domínio e recurso de auditoria", () => {
    for (const name of NOVAS) {
      const tool = registry.get(name)!;
      expect(tool.domain, name).toBeTruthy();
      if (tool.category === "write") expect(tool.auditResource, name).toBeTypeOf("function");
    }
  });

  it("operações destrutivas exigem capability específica", () => {
    for (const name of [
      "crm_delete_contact",
      "crm_archive_pipeline",
      "crm_archive_stage",
      "crm_delete_task",
      "crm_merge_or_delete_tag",
    ]) {
      expect(registry.get(name)?.capabilities, name).toContain("destructive_operations");
    }
  });

  it("filtros e paginação são parte dos contratos de listagem", () => {
    const contacts = z
      .object(registry.get("crm_search_contacts")!.inputSchema)
      .parse({ tag: "vip", source: "site", limit: 25 });
    expect(contacts).toMatchObject({ tag: "vip", source: "site", limit: 25 });
    const leads = z
      .object(registry.get("crm_list_leads")!.inputSchema)
      .parse({ query: "Proposta", tag: "quente", limit: 20 });
    expect(leads).toMatchObject({ query: "Proposta", tag: "quente", limit: 20 });
    const tasks = z
      .object(registry.get("crm_list_tasks")!.inputSchema)
      .parse({ open_only: true, limit: 10, offset: 20 });
    expect(tasks).toMatchObject({ open_only: true, limit: 10, offset: 20 });
  });
});
