-- 170 Visa Invoices: fall back to the group's total_nights for the Nights column.
--
-- Nights was computed only from covered_from/covered_to, so groups without a
-- coverage range showed blank even though they have arrival/departure dates
-- (umrah_groups.total_nights). Now it uses the covered range when present and
-- falls back to total_nights otherwise.
--
-- NOTE: run this against the DB (Supabase SQL editor or MCP).

create or replace function public.visa_invoice_ledger(p_from date, p_to date)
returns table(group_id uuid, visa_date date, company text, customer text, group_name text, group_no text, visa_type text, total_nights integer, pax integer, invoice_created boolean)
language sql stable security definer set search_path to 'public' as $function$
  select g.id,
         coalesce(g.visa_issued_at::date, g.group_date) as visa_date,
         gc.name as company,
         coalesce(a.agency_name, p.name) as customer,
         g.group_name, g.group_no, g.visa_type,
         coalesce(
           case when g.covered_from is not null and g.covered_to is not null
                then (g.covered_to - g.covered_from) end,
           nullif(g.total_nights, 0)
         ) as total_nights,
         g.pax,
         coalesce(g.invoice_created, false) as invoice_created
  from umrah_groups g
  left join group_companies gc on gc.id = g.group_company_id
  left join b2b_agents a on a.agent_party_id = g.agent_id
  left join parties p on p.id = g.agent_id
  where g.company_id = auth_company_id()
    and coalesce(g.workflow_status,'pending') <> 'rejected'
    and coalesce(g.visa_issued_at::date, g.group_date) between p_from and p_to
  order by g.created_at desc;
$function$;
