import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildManagedAreaPolicy } from "@/lib/managed-clients/policy";
import { lastLine, sql } from "./gov-helpers";

const actor = randomUUID();
const client = randomUUID();
const ordinaryAdmin = randomUUID();
const outsider = randomUUID();
const sourceOrg = randomUUID();
const key = randomUUID();
const slug = `managed-${randomUUID().slice(0, 8)}`;
const email = "client-managed-onboarding@invariant.test";
const request = JSON.stringify({
  display_name: "Clínica fixture",
  slug,
  plan: "standard",
  owner_email: "agency-managed-onboarding@invariant.test",
});
const policy = JSON.stringify(buildManagedAreaPolicy("managed/aesthetic-clinic"));
const call = `public.fn_begin_managed_client_onboarding('${actor}','${key}',
  '${request}'::jsonb,'abcd','${email}','${policy}'::jsonb)`;
const fixture = `
  insert into auth.users(id,email) values
    ('${actor}','agency-managed-onboarding@invariant.test'),
    ('${client}','${email}'),
    ('${ordinaryAdmin}','ordinary-admin@invariant.test'),
    ('${outsider}','outsider-managed@invariant.test');
  insert into public.platform_admins(user_id,granted_by,scope,mfa_required,reason)
    values ('${actor}','${actor}','full',false,'Fixture');
  insert into public.organizations(id,slug,display_name,legal_name)
    values ('${sourceOrg}','${sourceOrg}','Agência fixture','Agência fixture');
  insert into public.user_organizations(organization_id,user_id,role,accepted_at)
    values ('${sourceOrg}','${actor}','admin',now()),
           ('${sourceOrg}','${ordinaryAdmin}','admin',now());
`;

describe("onboarding gerenciado real em Postgres descartável", () => {
  it("cria via RPC oficial, conserva o gestor e não duplica no replay", () => {
    const output = sql(`begin; ${fixture}
      do $$ declare first_result jsonb; repeated jsonb; org uuid; begin
        first_result := ${call}; repeated := ${call};
        org := (first_result->>'organization_id')::uuid;
        if org <> (repeated->>'organization_id')::uuid or repeated->>'created' <> 'false'
          then raise exception 'onboarding duplicated'; end if;
        if (select count(*) from public.organizations where slug='${slug}') <> 1
          or (select count(*) from public.managed_client_policies where organization_id=org
              and preset_id='managed/aesthetic-clinic' and preset_version='1.0.0') <> 1
          or (select count(*) from public.user_organizations where organization_id=org
              and user_id='${actor}' and role='admin' and accepted_at is not null
              and provisional_until_handover=false) <> 1
          or (select count(*) from public.team_invites where organization_id=org
              and role='agent' and email='${email}') <> 1
          or (select count(*) from public.managed_client_onboardings where organization_id=org) <> 1
          then raise exception 'onboarding invariant failed'; end if;
        -- O mesmo usuário tem dois memberships, logo o switcher pode listar ambos.
        if (select count(*) from public.user_organizations where user_id='${actor}'
            and organization_id in ('${sourceOrg}',org)) <> 2
          then raise exception 'agency switcher membership missing'; end if;
      end $$;
      rollback; select 'proved';`);
    expect(lastLine(output)).toBe("proved");
  });

  it("falha intermediária reverte a transação; falha no convite retoma o mesmo recibo", () => {
    const output = sql(`begin; ${fixture}
      create function pg_temp.fail_policy() returns trigger language plpgsql as $$
        begin raise exception 'fixture policy failure'; end $$;
      create trigger fail_policy before insert on public.managed_client_policies
        for each row execute function pg_temp.fail_policy();
      do $$ begin
        begin perform ${call}; raise exception 'accepted partial creation';
        exception when others then
          if sqlerrm <> 'fixture policy failure' then raise; end if;
        end;
      end $$;
      drop trigger fail_policy on public.managed_client_policies;
      do $$ declare r jsonb; claimed jsonb; retry_claim jsonb; org uuid; begin
        r := ${call}; org := (r->>'organization_id')::uuid;
        claimed := public.fn_claim_managed_client_invite('${actor}','${key}','${randomUUID()}');
        if claimed->>'claimed' <> 'true' then raise exception 'claim failed'; end if;
        update public.managed_client_onboardings set state='failed' where organization_id=org;
        retry_claim := public.fn_claim_managed_client_invite('${actor}','${key}','${randomUUID()}');
        if retry_claim->>'claimed' <> 'true' then raise exception 'retry failed'; end if;
        if (select count(*) from public.organizations where slug='${slug}') <> 1
          or (select count(*) from public.team_invites where organization_id=org) <> 1
          then raise exception 'retry duplicated'; end if;
      end $$;
      rollback; select 'proved';`);
    expect(lastLine(output)).toBe("proved");
  });

  it.each(["admin", "manager", "agent"])(
    "%s comum é negado; cliente não altera preset ou recibo pelo PostgREST",
    (role) => {
      const output = sql(`begin; ${fixture}
      update public.user_organizations set role='${role}'
        where organization_id='${sourceOrg}' and user_id='${ordinaryAdmin}';
      do $$ begin
        begin perform public.fn_begin_managed_client_onboarding('${ordinaryAdmin}','${key}',
          '${request}'::jsonb,'abcd','${email}','${policy}'::jsonb);
          raise exception 'ordinary role accepted';
        exception when insufficient_privilege then null; end;
      end $$;
      select ${call};
      select public.fn_accept_team_invite('${client}',
        (select organization_id from public.managed_client_onboardings where actor_user_id='${actor}'),
        'agent','${actor}',now(),now());
      set local role authenticated;
      select set_config('request.jwt.claims','{"sub":"${client}"}',true);
      do $$ begin
        if has_function_privilege('authenticated',
          'public.fn_begin_managed_client_onboarding(uuid,uuid,jsonb,text,text,jsonb)','execute')
          or has_table_privilege('authenticated','public.managed_client_onboardings','UPDATE')
          or has_table_privilege('authenticated','public.managed_client_onboardings','SELECT')
          or has_table_privilege('authenticated','public.managed_client_policies','UPDATE')
          then raise exception 'client privilege leaked'; end if;
        if (select count(*) from public.managed_client_policies
          where organization_id='${sourceOrg}') <> 0 then raise exception 'cross tenant'; end if;
      end $$;
      rollback; select 'proved';`);
      expect(lastLine(output)).toBe("proved");
    },
  );
});
