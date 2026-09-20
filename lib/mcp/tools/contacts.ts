/**
 * MCP read tools sobre /api/v1/contacts (Spec 11 §3.1).
 *
 * Wrappa os handlers REST extraidos na wave 2 (S-13.02). O MCP server core
 * injeta `ctx.supabase` (admin client + service-role) e `ctx.organizationId`
 * — handlers ja aplicam `.eq('organization_id', ctx.organization_id)` em
 * defesa-em-profundidade pos wave 3 (RLS continua valida quando ctx vem
 * de cookie).
 */
import { z } from "zod";

import {
  listContactsHandler,
  getContactHandler,
  createContactHandler,
  patchContactHandler,
  deleteContactHandler,
} from "@/app/api/v1/contacts/_handler";
import type { McpToolDefinition } from "../types";
import { CAMPOS_PROPONIVEIS, proporDadoDoContato } from "@/lib/contacts/proposta-de-dado";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import { audit } from "@/lib/audit";
import { contactCreateSchemaDoPais, contactPatchSchemaDoPais } from "@/lib/schemas/contacts";
import { perfilDaOrganizacao } from "@/lib/legal/perfil-do-pais";
import { TIMELINE_COLS, decodeCursor, encodeCursor } from "@/lib/leads/timeline-query";
import { ApiError } from "@/lib/api/types";

const searchInputShape = {
  query: z.string().min(1).max(200).optional().describe("Termo de busca (nome, email ou telefone)."),
  tag: z.string().min(1).max(40).optional(),
  source: z.string().min(1).max(120).optional(),
  limit: z.number().int().min(1).max(50).default(10),
  cursor: z.string().optional(),
};

export const crmSearchContacts: McpToolDefinition<typeof searchInputShape> = {
  name: "crm_search_contacts",
  description:
    "Busca contatos do CRM por nome, email ou telefone. Retorna ate 50 matches com id, nome, telefone, email, tags e timestamps. Sempre escopado a organization do token.",
  inputSchema: searchInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  domain: "contacts",
  handler: async (input, ctx) => {
    const result = await listContactsHandler(
      ctx.supabase,
      {
        organization_id: ctx.organizationId,
        actor: ctx.actor,
        requestId: ctx.requestId,
      },
      {
        search: input.query,
        tag: input.tag,
        source: input.source,
        limit: input.limit,
        cursor: input.cursor,
      },
    );
    return {
      contacts: result.contacts.map((c) => ({
        id: c.id,
        name: nomeDoContato(c),
        phone: c.phone_number,
        email: c.email,
        tags: c.tags ?? [],
        is_blocked: c.is_blocked,
        is_anonymized: c.is_anonymized,
        created_at: c.created_at,
        last_activity_at: c.last_activity_at,
      })),
      cursor: result.cursor,
      has_more: result.has_more,
    };
  },
};

const contactWriteFields = {
  name: z.string().min(1).max(200).optional(),
  display_name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
  phone_number: z.string().regex(/^\+\d{8,15}$/).optional(),
  document: z.string().min(3).max(32).optional(),
  birthdate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  tags: z.array(z.string()).max(20).optional(),
  source: z.string().min(1).max(120).optional(),
  source_metadata: z.record(z.string(), z.unknown()).optional(),
  consent: z.record(z.string(), z.unknown()).optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
};

export const crmCreateContact: McpToolDefinition<typeof contactWriteFields> = {
  name: "crm_create_contact",
  description:
    "Cria um contato usando a mesma validação, deduplicação, conversa inicial, evento contact.created e auditoria da interface. O documento segue o país configurado na organização.",
  inputSchema: contactWriteFields,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  domain: "contacts",
  auditResource: (_input, result) => ({
    type: "contact",
    id: ((result as { contact?: { id?: string } } | undefined)?.contact?.id) ?? null,
  }),
  handler: async (input, ctx) => {
    const perfil = await perfilDaOrganizacao(ctx.supabase, ctx.organizationId);
    const parsed = contactCreateSchemaDoPais(perfil).parse({
      ...input,
      cpf: input.document,
      source: input.source ?? "mcp",
    });
    return createContactHandler(ctx.supabase, {
      organization_id: ctx.organizationId,
      actor: ctx.actor,
      requestId: ctx.requestId,
    }, parsed);
  },
};

const updateContactShape = { contact_id: z.string().uuid(), ...contactWriteFields };

export const crmUpdateContact: McpToolDefinition<typeof updateContactShape> = {
  name: "crm_update_contact",
  description:
    "Atualiza dados cadastrais, tags, consentimentos e campos personalizados de um contato existente. Para apenas aplicar ou remover tags, prefira crm_manage_tags.",
  inputSchema: updateContactShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  domain: "contacts",
  auditResource: (input) => ({ type: "contact", id: input.contact_id }),
  handler: async (input, ctx) => {
    const { contact_id, document, ...fields } = input;
    const perfil = await perfilDaOrganizacao(ctx.supabase, ctx.organizationId);
    const parsed = contactPatchSchemaDoPais(perfil).parse({ ...fields, cpf: document });
    const contact = await patchContactHandler(ctx.supabase, {
      organization_id: ctx.organizationId,
      actor: ctx.actor,
      requestId: ctx.requestId,
    }, contact_id, parsed);
    return { contact };
  },
};

const contactTimelineShape = {
  contact_id: z.string().uuid(),
  types: z.array(z.string().min(1).max(80)).max(20).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
};

export const crmGetContactTimeline: McpToolDefinition<typeof contactTimelineShape> = {
  name: "crm_get_contact_timeline",
  description:
    "Lista o histórico do contato e de seus negócios, com paginação e filtro por tipos de atividade. Não cria nem altera registros.",
  inputSchema: contactTimelineShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  domain: "contacts",
  handler: async (input, ctx) => {
    await getContactHandler(ctx.supabase, {
      organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId,
    }, { contactId: input.contact_id, decryptPurpose: null });
    const cursor = input.cursor ? decodeCursor(input.cursor) : null;
    if (input.cursor && !cursor) throw new ApiError(400, "invalid_cursor", undefined, ctx.requestId, "Cursor inválido.");
    const { data: leadRows, error: leadErr } = await ctx.supabase.from("crm_leads").select("id")
      .eq("organization_id", ctx.organizationId).eq("contact_id", input.contact_id);
    if (leadErr) throw new ApiError(500, "internal_error", undefined, ctx.requestId, leadErr.message);
    const leadIds = (leadRows ?? []).map((r: { id: string }) => r.id);
    let q = ctx.supabase.from("crm_lead_activities").select(TIMELINE_COLS)
      .eq("organization_id", ctx.organizationId)
      .order("performed_at", { ascending: false }).order("id", { ascending: false })
      .limit(input.limit + 1);
    const eixo = leadIds.length > 0
      ? `contact_id.eq.${input.contact_id},lead_id.in.(${leadIds.join(",")})`
      : `contact_id.eq.${input.contact_id}`;
    q = q.or(eixo);
    if (input.types?.length) q = q.in("type", input.types);
    if (cursor) q = q.or(`performed_at.lt.${cursor.performed_at},and(performed_at.eq.${cursor.performed_at},id.lt.${cursor.id})`);
    const { data, error } = await q;
    if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const last = page.at(-1);
    return { activities: page, has_more: hasMore, cursor: hasMore && last ? encodeCursor({ performed_at: String(last.performed_at), id: String(last.id) }) : null };
  },
};

const deleteContactShape = { contact_id: z.string().uuid() };

export const crmDeleteContact: McpToolDefinition<typeof deleteContactShape> = {
  name: "crm_delete_contact",
  description:
    "Executa a exclusão lógica/anonimização oficial de um contato, preservando histórico conforme LGPD. É irreversível e exige capability destructive_operations.",
  inputSchema: deleteContactShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "contacts",
  capabilities: ["destructive_operations"],
  auditResource: (input) => ({ type: "contact", id: input.contact_id }),
  handler: async (input, ctx) => {
    await deleteContactHandler(ctx.supabase, {
      organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId,
    }, input.contact_id);
    return { contact_id: input.contact_id, anonymized: true };
  },
};

const getInputShape = {
  contact_id: z.string().uuid().describe("UUID do contato."),
};

export const crmGetContact: McpToolDefinition<typeof getInputShape> = {
  name: "crm_get_contact",
  description:
    "Retorna detalhes de um contato pelo UUID. Inclui tags, consent, source. CPF nunca retornado em plaintext via MCP (sempre mascarado).",
  inputSchema: getInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  domain: "contacts",
  handler: async (input, ctx) => {
    const contact = await getContactHandler(
      ctx.supabase,
      {
        organization_id: ctx.organizationId,
        actor: ctx.actor,
        requestId: ctx.requestId,
      },
      { contactId: input.contact_id, decryptPurpose: null },
    );
    return {
      id: contact.id,
      name: contact.name,
      display_name: contact.display_name,
      email: contact.email,
      phone: contact.phone_number,
      tags: contact.tags ?? [],
      source: contact.source,
      consent: contact.consent ?? {},
      is_blocked: contact.is_blocked,
      is_anonymized: contact.is_anonymized,
      cpf_available: contact.cpf_available,
      created_at: contact.created_at,
      last_activity_at: contact.last_activity_at,
    };
  },
};

// ---------------------------------------------------------------------------
// crm_propose_contact_field — o dado que o cliente disse, PROPOSTO
// ---------------------------------------------------------------------------

const propostaShape = {
  contact_id: z.string().uuid(),
  campo: z.enum(CAMPOS_PROPONIVEIS).describe("Qual informação: email, name ou phone_number."),
  valor: z.string().min(1).max(200).describe("O valor exatamente como a pessoa informou."),
  trecho: z
    .string()
    .max(500)
    .optional()
    .describe("O que a pessoa escreveu, para quem for confirmar poder conferir."),
};

/**
 * ⚠️ Esta ferramenta NÃO grava o dado. Ela cria uma proposta que uma pessoa
 * confirma — e o `description` diz isso ao modelo em primeiro lugar, de
 * propósito: um modelo que acredite ter gravado responderia "pronto, já
 * atualizei seu cadastro" ao cliente, prometendo o que não aconteceu.
 *
 * Ela é de CATÁLOGO, e não nativa do Operador, porque o Operador não monta
 * ToolSet nativo nenhum (zero ocorrências de `tool(` em operator-turn.ts) e só
 * chama o modelo quando há MCP. Uma nativa não apareceria na tela que liga
 * capacidades, não entraria no audit `mcp.tool_called` e sumiria da telemetria
 * de uso — nasceria invisível ao invariante 3 do sistema vivo.
 */
export const crmProposeContactField: McpToolDefinition<typeof propostaShape> = {
  name: "crm_propose_contact_field",
  description:
    "Registra uma informação que o cliente forneceu (email, nome ou telefone) como PROPOSTA para " +
    "uma pessoa confirmar. NADA é gravado no cadastro por conta desta chamada, e a proposta vence " +
    "sozinha se ninguém decidir. Nunca diga ao cliente que o cadastro foi atualizado. Recusa se já " +
    "houver proposta do mesmo campo aguardando decisão, se o valor for igual ao que já está " +
    "gravado, ou se o contato foi anonimizado.",
  inputSchema: propostaShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const r = await proporDadoDoContato(ctx.supabase, {
      organizationId: ctx.organizationId,
      contactId: input.contact_id,
      campo: input.campo,
      valor: input.valor,
      trecho: input.trecho ?? null,
    });

    if (!r.criada) {
      // As mensagens são para o MODELO decidir o que fazer em seguida — e
      // nenhuma delas é para repetir ao cliente. Falam do fluxo interno, não do
      // atendimento.
      const explicacao: Record<string, string> = {
        contato_nao_encontrado: "não encontrei esse contato nesta conta.",
        contato_anonimizado:
          "esse contato exerceu o direito de exclusão de dados; não é possível registrar informações dele.",
        valor_invalido: "o valor não tem forma de email/telefone/nome válido — confirme com a pessoa.",
        valor_igual_ao_atual: "essa informação já está no cadastro; não há o que confirmar.",
        ja_existe_proposta:
          "já existe uma proposta desse mesmo campo aguardando decisão de uma pessoa — não crie outra.",
        erro: "não consegui registrar a proposta agora.",
      };
      return { proposta_criada: false, motivo: r.motivo, mensagem: explicacao[r.motivo] };
    }

    // Mesmo payload de ator das outras tools de escrita. Inline porque
    // `retencao.ts` mantém o dele local — extrair para um módulo comum tocaria
    // um arquivo alheio sem que este trabalho peça isso.
    const a =
      ctx.actor.type === "user"
        ? { actorUserId: ctx.actor.id as string | null, metadataActor: { actor_type: "user" } }
        : { actorUserId: null, metadataActor: { actor_type: ctx.actor.type, actor_id: ctx.actor.id } };
    await audit({
      action: "contact.field_proposed",
      actorUserId: a.actorUserId,
      organizationId: ctx.organizationId,
      resourceType: "contact",
      resourceId: input.contact_id,
      requestId: ctx.requestId,
      // O par antes/depois desde a PROPOSTA, mesma grafia de `team.role_changed`.
      // A proposta é uma intenção auditável mesmo que nunca vire escrita.
      metadata: {
        ...a.metadataActor,
        proposal_id: r.id,
        campo: input.campo,
        old_value: r.valorAnterior,
        new_value: input.valor,
      },
    });

    return {
      proposta_criada: true,
      proposta_id: r.id,
      campo: input.campo,
      aguardando: "confirmação de uma pessoa",
    };
  },
};
