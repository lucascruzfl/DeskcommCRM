-- A 0472 trocou a leitura do trigger pela projeção operational_crm_pipelines.
-- A projeção, por desenho, filtra motivos em forma de objeto; desde a 0426 a
-- configuração canônica aceita {label,categoria}. O trigger via projeção
-- recusava qualquer perda categorizada com lost_reason_invalid. A função de
-- trigger corre na escrita da própria linha e recebe pipeline_id validado pelo
-- FK; a tabela base é a fonte correta para validar a configuração completa.
-- Sem mudança de dados ou coluna; CREATE OR REPLACE é idempotente no upgrade.
create or replace function public.fn_validate_lost_reason_required()
returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $function$
declare
  v_canonical text[] := array['requested_by_customer','price','no_response','product_unavailable',
                              'cancelled_by_store','cancelled_by_customer','payment_failed','other',
                              'moved_to_another_pipeline'];
  v_pipeline_extra text[];
begin
  if new.status = 'lost' then
    if new.lost_reason is null or length(new.lost_reason) = 0 then
      raise exception 'lost_reason_required' using errcode = '22023';
    end if;
    select coalesce(
      array(
        select case when jsonb_typeof(e) = 'object'
                    then nullif(e ->> 'label', '')
                    else nullif(e #>> '{}', '') end
          from jsonb_array_elements(settings->'lost_reasons') as t(e)
      ), '{}'::text[]
    ) into v_pipeline_extra
    from public.crm_pipelines
    where id = new.pipeline_id and organization_id = new.organization_id;
    if not (new.lost_reason = any (v_canonical) or new.lost_reason = any (v_pipeline_extra)) then
      raise exception 'lost_reason_invalid: %', new.lost_reason using errcode = '22023';
    end if;
  end if;
  return new;
end$function$;

revoke all on function public.fn_validate_lost_reason_required() from public, anon;
grant execute on function public.fn_validate_lost_reason_required() to authenticated, service_role;
