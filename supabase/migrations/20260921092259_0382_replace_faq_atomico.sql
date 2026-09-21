-- 0382_replace_faq_atomico.sql
-- Substitui o conjunto de FAQ em uma única transação, sem janela vazia.

create or replace function public.fn_replace_knowledge_faq_items(
  p_organization_id uuid,
  p_knowledge_source_id uuid,
  p_items jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_count integer;
begin
  if auth.uid() is not null
     and not public.fn_role_at_least(p_organization_id, 'manager') then
    raise exception 'knowledge_faq_forbidden' using errcode = '42501';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 500 then
    raise exception 'knowledge_faq_invalid_items' using errcode = 'PT422';
  end if;

  if not exists (
    select 1 from public.ai_knowledge_sources
     where id = p_knowledge_source_id
       and organization_id = p_organization_id
       and source_type = 'faq'
       and status <> 'archived'
  ) then
    raise exception 'knowledge_faq_source_not_found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) as item
     where nullif(btrim(item ->> 'question'), '') is null
        or nullif(btrim(item ->> 'answer'), '') is null
  ) then
    raise exception 'knowledge_faq_invalid_item' using errcode = 'PT422';
  end if;

  delete from public.ai_faq_items
   where organization_id = p_organization_id
     and knowledge_source_id = p_knowledge_source_id;

  insert into public.ai_faq_items (
    organization_id, knowledge_source_id, question, answer, tags, locale, position
  )
  select
    p_organization_id,
    p_knowledge_source_id,
    btrim(item ->> 'question'),
    btrim(item ->> 'answer'),
    case
      when jsonb_typeof(item -> 'tags') = 'array'
        then array(select jsonb_array_elements_text(item -> 'tags'))
      else '{}'::text[]
    end,
    coalesce(nullif(btrim(item ->> 'locale'), ''), 'pt-BR'),
    ordinality::integer - 1
  from jsonb_array_elements(p_items) with ordinality as entries(item, ordinality);

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke execute on function public.fn_replace_knowledge_faq_items(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.fn_replace_knowledge_faq_items(uuid, uuid, jsonb)
  to service_role;
