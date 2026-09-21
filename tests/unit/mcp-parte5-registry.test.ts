import { describe, expect, it } from "vitest";

import { MCP_REGISTRY, MCP_TOOL_COUNT } from "@/lib/mcp/registry";

const AGENDA = [
  "crm_get_event_type",
  "crm_create_event_type",
  "crm_update_event_type",
  "crm_set_event_type_active",
  "crm_list_availability",
  "crm_update_availability",
  "crm_list_availability_exceptions",
  "crm_create_availability_exception",
  "crm_delete_availability_exception",
] as const;

const FOLLOWUP = [
  "crm_list_followup_flows",
  "crm_get_followup_flow",
  "crm_create_followup_flow",
  "crm_update_followup_flow",
  "crm_preflight_followup_flow",
  "crm_publish_followup_flow",
  "crm_set_followup_flow_active",
  "crm_delete_followup_flow",
  "crm_list_followup_enrollments",
  "crm_get_followup_enrollment",
  "crm_control_followup_enrollment",
] as const;

const AUTOMACOES = [
  "crm_discover_automation_triggers",
  "crm_discover_automation_actions",
  "crm_get_automation_rule",
  "crm_preflight_automation_rule",
  "crm_create_automation_rule",
  "crm_update_automation_rule",
  "crm_duplicate_automation_rule",
  "crm_delete_automation_rule",
  "crm_simulate_automation_rule",
  "crm_get_automation_run",
] as const;

const ROUTING = [
  "crm_get_routing_config",
  "crm_update_routing_config",
  "crm_list_routing_destinations",
  "crm_update_channel_routing",
  "crm_simulate_routing",
] as const;

const PARTE_5 = [...AGENDA, ...FOLLOWUP, ...AUTOMACOES, ...ROUTING] as const;
const registry = new Map(MCP_REGISTRY.map((tool) => [tool.name, tool]));

describe("registry MCP da Parte 5", () => {
  it("preserva as 35 tools da Parte 5 no catálogo ampliado, sem duplicidade", () => {
    expect(AGENDA).toHaveLength(9);
    expect(FOLLOWUP).toHaveLength(11);
    expect(AUTOMACOES).toHaveLength(10);
    expect(ROUTING).toHaveLength(5);
    expect(PARTE_5).toHaveLength(35);
    expect(MCP_TOOL_COUNT).toBe(190);
    expect(new Set(MCP_REGISTRY.map((tool) => tool.name)).size).toBe(190);
    for (const name of PARTE_5) expect(registry.has(name), name).toBe(true);
  });

  it("nenhuma tool nova aceita organization_id", () => {
    for (const name of PARTE_5) {
      expect(Object.keys(registry.get(name)!.inputSchema), name).not.toContain("organization_id");
    }
  });

  it("toda escrita declara recurso auditável e domínio explícito", () => {
    for (const name of PARTE_5) {
      const tool = registry.get(name)!;
      expect(tool.domain, name).toBeTruthy();
      if (tool.category === "write") expect(tool.auditResource, name).toBeTypeOf("function");
    }
  });
});
