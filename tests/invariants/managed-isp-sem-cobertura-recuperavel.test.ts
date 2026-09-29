import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ISP_LOST_REASONS, SEED_PIPELINE_SETTINGS, SEED_PIPELINE_VOCABULARY } from "@/lib/managed-clients/isp-package";
import { lastLine, sql } from "./gov-helpers";

describe("lead ISP sem cobertura no Postgres descartável", () => {
  it("fecha com motivo real, conserva o registro/tag e permite consulta futura só na organização", () => {
    const org = randomUUID();
    const other = randomUUID();
    const reasons = JSON.stringify(ISP_LOST_REASONS).replaceAll("'", "''");
    const seedSettings = JSON.stringify(SEED_PIPELINE_SETTINGS).replaceAll("'", "''");
    const seedVocabulary = JSON.stringify(SEED_PIPELINE_VOCABULARY).replaceAll("'", "''");
    const out = sql(`begin;
      insert into organizations(id,slug,display_name,legal_name)
        values ('${org}','isp-${org}','Provedor teste','Provedor teste'),
               ('${other}','isp-${other}','Outro provedor','Outro provedor');
      do $$ begin
        if (select count(*) from crm_pipelines where organization_id='${org}'
              and name='Pedidos' and slug='pedidos' and is_default
              and settings='${seedSettings}'::jsonb
              and vocabulary='${seedVocabulary}'::jsonb) <> 1
          then raise exception 'seed canônico divergiu'; end if;
      end $$;
      do $$ declare p uuid; opened uuid; lost uuid; lead uuid; begin
        insert into crm_pipelines(organization_id,name,slug,position,settings)
          values ('${org}','Vendas — Internet','vendas-internet',100,
                  jsonb_build_object('lost_reasons','${reasons}'::jsonb)) returning id into p;
        insert into crm_stages(organization_id,pipeline_id,name,slug,position)
          values ('${org}',p,'Verificar cobertura','verificar-cobertura',1000) returning id into opened;
        insert into crm_stages(organization_id,pipeline_id,name,slug,position,is_lost,agent_stage_hint)
          values ('${org}',p,'Não contratado','nao-contratado',2000,true,'lost') returning id into lost;
        insert into crm_leads(organization_id,pipeline_id,stage_id,title,status,tags)
          values ('${org}',p,opened,'Expansão de área','open',array['lead','sem-cobertura']) returning id into lead;
        update crm_leads set stage_id=lost,lost_reason='Sem cobertura'
          where id=lead and organization_id='${org}';
        if (select count(*) from crm_leads where id=lead and organization_id='${org}'
              and status='lost' and lost_reason='Sem cobertura'
              and 'sem-cobertura'=any(tags) and closed_at is not null) <> 1
          then raise exception 'lead perdido não recuperável'; end if;
        if (select count(*) from crm_leads where id=lead and organization_id='${other}') <> 0
          then raise exception 'consulta cruzou tenant'; end if;
      end $$;
      rollback; select 'proved';`);
    expect(lastLine(out)).toBe("proved");
  });
});
