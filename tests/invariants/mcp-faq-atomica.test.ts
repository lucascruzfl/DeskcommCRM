import { beforeAll, describe, expect, it } from "vitest";

import { GOV_ORG, seedGov, sql } from "./gov-helpers";

const FONTE = "f6111111-0000-4000-8000-000000000001";

describe("substituição atômica da FAQ para HTTP e MCP", () => {
  beforeAll(() => {
    seedGov();
    sql(`
      insert into public.ai_knowledge_sources
        (id, organization_id, agent_id, source_type, name, status, is_active)
      values ('${FONTE}', '${GOV_ORG}', null, 'faq', 'FAQ MCP', 'ready', true)
      on conflict (id) do nothing;
      insert into public.ai_faq_items
        (organization_id, knowledge_source_id, question, answer, position)
      values ('${GOV_ORG}', '${FONTE}', 'Antiga?', 'Resposta antiga', 0)
      on conflict do nothing;
    `);
  });

  it("troca o conjunto inteiro quando todos os itens são válidos", () => {
    expect(
      sql(`select public.fn_replace_knowledge_faq_items('${GOV_ORG}', '${FONTE}',
      '[{"question":"Nova 1?","answer":"Resposta 1"},{"question":"Nova 2?","answer":"Resposta 2"}]'::jsonb);`),
    ).toBe("2");
    expect(
      sql(`select count(*) from public.ai_faq_items where knowledge_source_id='${FONTE}';`),
    ).toBe("2");
  });

  it("preserva o conjunto anterior quando qualquer item é inválido", () => {
    expect(() =>
      sql(`select public.fn_replace_knowledge_faq_items('${GOV_ORG}', '${FONTE}',
      '[{"question":"","answer":"inválida"}]'::jsonb);`),
    ).toThrow();
    expect(
      sql(
        `select string_agg(question, ',' order by position) from public.ai_faq_items where knowledge_source_id='${FONTE}';`,
      ),
    ).toBe("Nova 1?,Nova 2?");
  });

  it("recusa uma organização diferente da dona da fonte", () => {
    expect(() =>
      sql(`select public.fn_replace_knowledge_faq_items(
        '00000000-0000-4000-8000-000000000099',
        '${FONTE}',
        '[{"question":"Intrusa?","answer":"Não pode entrar"}]'::jsonb
      );`),
    ).toThrow();
    expect(
      sql(
        `select string_agg(question, ',' order by position) from public.ai_faq_items where knowledge_source_id='${FONTE}';`,
      ),
    ).toBe("Nova 1?,Nova 2?");
  });

  it("não fica executável pelos papéis públicos", () => {
    expect(
      sql(
        `select has_function_privilege('anon', 'public.fn_replace_knowledge_faq_items(uuid,uuid,jsonb)', 'execute');`,
      ),
    ).toBe("f");
    expect(
      sql(
        `select has_function_privilege('authenticated', 'public.fn_replace_knowledge_faq_items(uuid,uuid,jsonb)', 'execute');`,
      ),
    ).toBe("f");
    expect(
      sql(
        `select has_function_privilege('service_role', 'public.fn_replace_knowledge_faq_items(uuid,uuid,jsonb)', 'execute');`,
      ),
    ).toBe("t");
  });
});
