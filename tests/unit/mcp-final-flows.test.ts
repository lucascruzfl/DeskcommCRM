import { describe, expect, it } from "vitest";

import type { McpAuthResult } from "@/lib/mcp/auth";
import { capabilitiesOf } from "@/lib/mcp/policy";
import { MCP_REGISTRY, mcpPublicProfile } from "@/lib/mcp/registry";
import { MCP_OPERATION_PRESET } from "@/lib/mcp/scopes";

interface FlowStep {
  tool: string;
  discovery?: boolean;
  externalEffect?: boolean;
  mockOnly?: boolean;
  humanAction?: boolean;
}

interface FlowContract {
  domain: string;
  steps: FlowStep[];
}

/**
 * Contratos ponta a ponta da auditoria final. Eles não executam efeitos reais:
 * cada passo externo termina em mock/sandbox ou em ação humana estruturada.
 */
const FLOWS: FlowContract[] = [
  {
    domain: "ia",
    steps: [
      { tool: "crm_list_ai_providers", discovery: true },
      { tool: "crm_list_ai_credentials", discovery: true },
      { tool: "crm_list_ai_models", discovery: true },
      { tool: "crm_validate_agent_ai_configuration" },
      { tool: "crm_create_ai_agent" },
      { tool: "crm_create_ai_agent_version" },
      { tool: "crm_update_ai_agent_version" },
      { tool: "crm_preflight_ai_agent_version" },
      { tool: "crm_test_ai_agent_version", externalEffect: true, mockOnly: true },
      { tool: "crm_publish_ai_agent_version" },
      { tool: "crm_get_published_ai_agent_version" },
      { tool: "crm_activate_ai_agent" },
    ],
  },
  {
    domain: "crm-kanban",
    steps: [
      { tool: "crm_create_contact" },
      { tool: "crm_create_lead" },
      { tool: "crm_list_pipelines", discovery: true },
      { tool: "crm_list_stages", discovery: true },
      { tool: "crm_set_custom_field_values" },
      { tool: "crm_manage_tags" },
      { tool: "crm_list_team_members", discovery: true },
      { tool: "crm_update_lead" },
      { tool: "crm_move_lead_stage" },
      { tool: "crm_get_lead_timeline" },
    ],
  },
  {
    domain: "atendimento",
    steps: [
      { tool: "crm_list_messaging_channels", discovery: true },
      { tool: "crm_start_conversation_and_send", externalEffect: true, mockOnly: true },
      { tool: "crm_reply_message", externalEffect: true, mockOnly: true },
      { tool: "crm_assign_conversation" },
      { tool: "crm_request_human_handoff" },
      { tool: "crm_list_handoff_history" },
      { tool: "crm_resume_ai_attendance" },
      { tool: "crm_close_conversation" },
      { tool: "crm_reopen_conversation" },
    ],
  },
  {
    domain: "agenda",
    steps: [
      { tool: "crm_list_event_types", discovery: true },
      { tool: "crm_list_availability", discovery: true },
      { tool: "crm_find_free_slots", discovery: true },
      { tool: "crm_book_appointment", externalEffect: true, mockOnly: true },
      { tool: "crm_reschedule_appointment", externalEffect: true, mockOnly: true },
      { tool: "crm_cancel_appointment", externalEffect: true, mockOnly: true },
      { tool: "crm_set_appointment_outcome", humanAction: true },
    ],
  },
  {
    domain: "follow-up",
    steps: [
      { tool: "crm_list_followup_flows", discovery: true },
      { tool: "crm_create_followup_flow" },
      { tool: "crm_update_followup_flow" },
      { tool: "crm_preflight_followup_flow" },
      { tool: "crm_publish_followup_flow" },
      { tool: "crm_set_followup_flow_active" },
      { tool: "crm_enroll_followup_flow" },
      { tool: "crm_control_followup_enrollment", externalEffect: true, mockOnly: true },
    ],
  },
  {
    domain: "automacoes",
    steps: [
      { tool: "crm_discover_automation_triggers", discovery: true },
      { tool: "crm_discover_automation_actions", discovery: true },
      { tool: "crm_create_automation_rule" },
      { tool: "crm_update_automation_rule" },
      { tool: "crm_preflight_automation_rule" },
      { tool: "crm_simulate_automation_rule", externalEffect: true, mockOnly: true },
      { tool: "crm_set_automation_rule_active" },
      { tool: "crm_get_automation_run" },
    ],
  },
  {
    domain: "routing",
    steps: [
      { tool: "crm_list_routing_destinations", discovery: true },
      { tool: "crm_update_routing_config" },
      { tool: "crm_update_channel_routing" },
      { tool: "crm_simulate_routing", externalEffect: true, mockOnly: true },
    ],
  },
  {
    domain: "knowledge",
    steps: [
      { tool: "crm_list_knowledge_sources", discovery: true },
      { tool: "crm_create_knowledge_source" },
      { tool: "crm_update_knowledge_source" },
      { tool: "crm_replace_knowledge_faq" },
      { tool: "crm_reindex_knowledge_source" },
      { tool: "crm_get_knowledge_source" },
      { tool: "crm_update_ai_agent_version" },
    ],
  },
  {
    domain: "integracoes-canais",
    steps: [
      { tool: "crm_discover_integrations", discovery: true },
      { tool: "crm_get_channel_admin", discovery: true },
      { tool: "crm_prepare_integration_action", humanAction: true },
      { tool: "crm_prepare_channel_action", humanAction: true },
    ],
  },
  {
    domain: "equipe",
    steps: [
      { tool: "crm_list_team_members", discovery: true },
      { tool: "crm_get_team_member" },
      { tool: "crm_invite_team_member", externalEffect: true, mockOnly: true },
      { tool: "crm_update_team_member_interface" },
      { tool: "crm_update_team_member_role" },
      { tool: "crm_revoke_team_member" },
      { tool: "crm_reactivate_team_member" },
    ],
  },
  {
    domain: "import-export-bulk",
    steps: [
      { tool: "crm_get_contact_import_instructions", discovery: true },
      { tool: "crm_get_lead_import_instructions", discovery: true },
      { tool: "crm_get_product_import_instructions", discovery: true },
      { tool: "crm_preview_lead_bulk_action" },
      { tool: "crm_prepare_lead_bulk_action", humanAction: true },
      { tool: "crm_prepare_audit_export", humanAction: true },
      { tool: "crm_get_privacy_export_status" },
    ],
  },
  {
    domain: "campanhas-1.42",
    steps: [
      { tool: "crm_list_campaigns", discovery: true },
      { tool: "crm_preview_campaign" },
      { tool: "crm_create_campaign_draft" },
      { tool: "crm_update_campaign_draft" },
      { tool: "crm_prepare_campaign" },
      { tool: "crm_list_campaign_recipients" },
      { tool: "crm_get_campaign_metrics" },
      { tool: "crm_prepare_campaign_launch", externalEffect: true, humanAction: true },
      { tool: "crm_pause_campaign" },
    ],
  },
];

const auth: McpAuthResult = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  role: "manager",
  actor: {
    type: "api_token",
    id: "00000000-0000-4000-8000-000000000002",
    role: "manager",
  },
  apiTokenId: "00000000-0000-4000-8000-000000000002",
  scopes: [...MCP_OPERATION_PRESET],
};

describe("harness final de fluxos MCP", () => {
  it("descobre dinamicamente todos os passos pelo tools/list do preset manager", () => {
    const visible = new Set(mcpPublicProfile(auth).map((tool) => tool.name));
    for (const flow of FLOWS) {
      for (const step of flow.steps)
        expect(visible.has(step.tool), `${flow.domain}:${step.tool}`).toBe(true);
    }
  });

  it("não depende de contagem fixa nem de IDs adivinhados", () => {
    expect(FLOWS).toHaveLength(12);
    expect(FLOWS.every((flow) => flow.steps.some((step) => step.discovery))).toBe(true);
    expect(JSON.stringify(FLOWS)).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27,}/i);
  });

  it("mantém efeitos externos confinados a mock, sandbox ou ação humana", () => {
    for (const flow of FLOWS) {
      for (const step of flow.steps.filter((candidate) => candidate.externalEffect)) {
        expect(step.mockOnly || step.humanAction, `${flow.domain}:${step.tool}`).toBe(true);
      }
    }
  });

  it("preserva capabilities explícitas nas transições de maior risco", () => {
    const byName = new Map(MCP_REGISTRY.map((tool) => [tool.name, tool]));
    const expected = new Map<string, string>([
      ["crm_publish_ai_agent_version", "agent_publication"],
      ["crm_activate_ai_agent", "agent_activation"],
      ["crm_publish_followup_flow", "automation_activation"],
      ["crm_set_automation_rule_active", "automation_activation"],
      ["crm_start_conversation_and_send", "send_messages"],
      ["crm_reply_message", "send_messages"],
      ["crm_request_human_handoff", "human_handoff"],
    ]);
    for (const [name, capability] of expected) {
      expect(capabilitiesOf(byName.get(name)!), name).toContain(capability);
      expect(MCP_OPERATION_PRESET).toContain(`capability:${capability}`);
    }
  });
});
