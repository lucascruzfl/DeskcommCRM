-- A projeção geral filtra motivos em forma de objeto, aceitos desde a 0426.
-- Expor somente os rótulos necessários à operação mantém settings privados;
-- a view aplica membership e área kanban antes de entregar qualquer linha.
-- O trigger permanece invoker e cruza id + organização do lead. Array vazio
-- (inclusive quando não há linha visível) recusa motivo não canônico.
create or replace view public.operational_crm_lost_reason_labels
with (security_barrier = true) as
select p.id, p.organization_id,
       array(
         select case when jsonb_typeof(reason.value) = 'object' then reason.value->>'label'
                     else reason.value #>> '{}' end
         from jsonb_array_elements(case when jsonb_typeof(p.settings->'lost_reasons') = 'array'
           then p.settings->'lost_reasons' else '[]'::jsonb end) as reason(value)
         where (jsonb_typeof(reason.value) = 'object' and nullif(reason.value->>'label', '') is not null)
            or (jsonb_typeof(reason.value) = 'string' and nullif(reason.value #>> '{}', '') is not null)
       ) as labels
from public.crm_pipelines p
where (p.organization_id in (select public.fn_user_org_ids())
       and public.fn_managed_area_allowed(p.organization_id, '/app/kanban'))
   or public.fn_is_platform_admin()
   or current_user in ('service_role', 'postgres');
revoke all on public.operational_crm_lost_reason_labels from public, anon, authenticated, service_role;
grant select on public.operational_crm_lost_reason_labels to authenticated, service_role;

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
    select labels into v_pipeline_extra
    from public.operational_crm_lost_reason_labels
    where id = new.pipeline_id and organization_id = new.organization_id;
    if not (new.lost_reason = any (v_canonical)
            or new.lost_reason = any (coalesce(v_pipeline_extra, '{}'::text[]))) then
      raise exception 'lost_reason_invalid: %', new.lost_reason using errcode = '22023';
    end if;
  end if;
  return new;
end$function$;

revoke all on function public.fn_validate_lost_reason_required() from public, anon;
grant execute on function public.fn_validate_lost_reason_required() to authenticated, service_role;
