import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ISP_LOST_REASONS, SEED_PIPELINE_SETTINGS, SEED_PIPELINE_VOCABULARY } from "@/lib/managed-clients/isp-package";
import { buildManagedAreaPolicy } from "@/lib/managed-clients/policy";
import { lastLine, sql } from "./gov-helpers";

describe("lead ISP sem cobertura no Postgres descartável", () => {
  it("cliente managed fecha pelos três motivos sem ler configuração e não valida motivo de outro tenant", () => {
    const org = randomUUID();
    const other = randomUUID();
    const actor = randomUUID();
    const pipeline = randomUUID();
    const foreignPipeline = randomUUID();
    const opened = randomUUID();
    const lost = randomUUID();
    const reasons = JSON.stringify(ISP_LOST_REASONS).replaceAll("'", "''");
    const areas = JSON.stringify(buildManagedAreaPolicy("managed/internet-provider").areas).replaceAll("'", "''");
    const out = sql(`begin;
      insert into auth.users(id,email) values ('${actor}','isp-managed-${actor}@invariant.test');
      insert into organizations(id,slug,display_name,legal_name) values
        ('${org}','isp-${org}','Provedor A','Provedor A'),
        ('${other}','isp-${other}','Provedor B','Provedor B');
      insert into user_organizations(organization_id,user_id,role,accepted_at)
        values ('${org}','${actor}','agent',now());
      insert into managed_client_policies(organization_id,business_type,management_mode,preset_id,preset_version,areas,applied_by)
        values ('${org}','internet_provider','managed','managed/internet-provider','1.0.0','${areas}'::jsonb,'${actor}');
      insert into crm_pipelines(id,organization_id,name,slug,settings) values
        ('${pipeline}','${org}','Vendas Internet','vendas-internet',jsonb_build_object('lost_reasons','${reasons}'::jsonb)),
        ('${foreignPipeline}','${other}','Outro funil','outro-funil','{"lost_reasons":[{"label":"Motivo B","categoria":"Outro"}]}'::jsonb);
      insert into crm_stages(id,organization_id,pipeline_id,name,slug,position,is_lost) values
        ('${opened}','${org}','${pipeline}','Aberto','aberto',1000,false),
        ('${lost}','${org}','${pipeline}','Perdido','perdido',2000,true);
      set local role authenticated;
      select set_config('request.jwt.claims','{"sub":"${actor}"}',true);
      do $$ declare lead uuid; reason text; error_message text; begin
        if exists(select 1 from crm_pipelines where id='${pipeline}') then raise exception 'configuração base exposta'; end if;
        if not exists(select 1 from operational_crm_lost_reason_labels
          where id='${pipeline}' and organization_id='${org}' and 'Sem cobertura'=any(labels))
          then raise exception 'rótulos operacionais não disponíveis'; end if;
        if exists(select 1 from operational_crm_lost_reason_labels where id='${foreignPipeline}')
          then raise exception 'rótulos do tenant B expostos'; end if;
        foreach reason in array array['Sem cobertura','Desistiu','Sem retorno'] loop
          insert into crm_leads(organization_id,pipeline_id,stage_id,title,owner_user_id)
            values ('${org}','${pipeline}','${opened}','Lead ISP', '${actor}') returning id into lead;
          update crm_leads set stage_id='${lost}',lost_reason=reason where id=lead;
          if not exists(select 1 from crm_leads where id=lead and status='lost' and lost_reason=reason)
            then raise exception 'motivo legítimo recusado: %',reason; end if;
        end loop;
        insert into crm_leads(organization_id,pipeline_id,stage_id,title,owner_user_id)
          values ('${org}','${pipeline}','${opened}','Lead cruzado','${actor}') returning id into lead;
        begin
          update crm_leads set pipeline_id='${foreignPipeline}',stage_id='${lost}',lost_reason='Motivo B' where id=lead;
          raise exception 'motivo do tenant B aceito';
        exception when sqlstate '22023' then
          get stacked diagnostics error_message = message_text;
          if error_message not like 'lost_reason_invalid:%'
            then raise exception 'recusa veio de outra regra: %',error_message; end if;
        end;
        if not exists(select 1 from crm_leads where id=lead and status='open' and pipeline_id='${pipeline}')
          then raise exception 'tentativa cruzada alterou lead'; end if;
      end $$;
      rollback; select 'proved';`);
    expect(lastLine(out)).toBe("proved");
  });

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
