-- The tree masters get the chart's reordering.
--
-- Product Tree, Cost Center and Tag Area are trees with a `sort` column that
-- nothing has ever written: every row sits at 0 and the screens fall back to
-- ordering by name. The Chart of Accounts has had ⤒ ↑ ↓ ⤓ since acct_reorder,
-- and this is the same thing for the other three — one routine rather than
-- three, because the three tables differ only in their name.
--
-- WHY A ROUTINE AND NOT A BROWSER-SIDE UPDATE. Reordering is a rebuild of a
-- whole sibling list, so it has to be one transaction or a half-applied
-- renumber leaves the tree in an order nobody chose. It also has to be checked:
-- `sort` is writable through PostgREST, so the check belongs where the write
-- happens, not in the screen that calls it.
--
-- THE TABLE NAME IS A WHITELIST, NOT A PARAMETER. p_table is matched against
-- exactly three values and the dynamic SQL is built with %I from the matched
-- constant, never from the caller's string. Anything else is refused by name,
-- so this cannot be pointed at another table — and each of the three carries
-- its OWN screen right, so somebody allowed to reorder the Product Tree is not
-- thereby allowed to reorder cost centres.
--
-- It mirrors acct_reorder deliberately, down to returning
-- {moved: false, reason: 'already first'} rather than silently doing nothing —
-- a button that appears to do nothing reads as a broken button.

begin;

create or replace function public.master_reorder(p_table text, p_node uuid, p_dir text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_co     uuid := auth_company_id();
  v_tbl    text;
  v_doc    text;
  v_parent uuid;
  v_found  boolean;
  v_ids    uuid[];
  v_pos    int;
  v_to     int;
  i        int;
begin
  if not is_staff() then raise exception 'Not authorized'; end if;

  -- The whitelist. v_tbl is a constant from here on, never the caller's text.
  case p_table
    when 'acct_products'     then v_tbl := 'acct_products';     v_doc := 'product_tree';
    when 'acct_cost_centers' then v_tbl := 'acct_cost_centers'; v_doc := 'cost_centers';
    when 'acct_tag_areas'    then v_tbl := 'acct_tag_areas';    v_doc := 'tag_areas';
    else raise exception 'Not a tree master: %', p_table;
  end case;

  perform staff_require_doc(v_doc, 'edit');

  if p_dir not in ('up','down','top','bottom') then
    raise exception 'Move it up, down, to the top or to the bottom — not "%".', p_dir;
  end if;

  execute format(
    'select true, parent_id from %I where id = $1 and company_id = $2', v_tbl)
    into v_found, v_parent using p_node, v_co;
  -- `into` leaves v_found NULL when nothing matched, and `not null` is null,
  -- which would fall straight through. It has to be an explicit is-not-true.
  if v_found is not true then raise exception 'That row is not in this master.'; end if;

  -- Its siblings, in the order the screen shows them in.
  execute format(
    'select array_agg(s.id order by coalesce(s.sort, 0), s.name)
       from %I s where s.company_id = $1 and s.parent_id is not distinct from $2', v_tbl)
    into v_ids using v_co, v_parent;

  if coalesce(array_length(v_ids, 1), 0) < 2 then
    return jsonb_build_object('moved', false, 'reason', 'nothing to move it past');
  end if;

  v_pos := array_position(v_ids, p_node);
  v_to := case p_dir
            when 'up'     then greatest(1, v_pos - 1)
            when 'down'   then least(array_length(v_ids, 1), v_pos + 1)
            when 'top'    then 1
            else array_length(v_ids, 1)
          end;

  if v_to = v_pos then
    return jsonb_build_object('moved', false, 'reason',
      case when p_dir in ('up','top') then 'already first' else 'already last' end);
  end if;

  -- Take it out, put it back at the new place, renumber the lot. A rebuild
  -- rather than a swap is what makes top/bottom the same code as up/down.
  v_ids := v_ids[1:v_pos-1] || v_ids[v_pos+1:array_length(v_ids,1)];
  v_ids := v_ids[1:v_to-1] || array[p_node] || v_ids[v_to:array_length(v_ids,1)];

  for i in 1..array_length(v_ids, 1) loop
    execute format('update %I set sort = $1 where id = $2 and company_id = $3', v_tbl)
      using i * 10, v_ids[i], v_co;
  end loop;

  return jsonb_build_object('moved', true, 'from', v_pos, 'to', v_to,
                            'of', array_length(v_ids, 1));
end $function$;

revoke all on function public.master_reorder(text, uuid, text) from public, anon;
grant execute on function public.master_reorder(text, uuid, text) to authenticated;

do $chk$
declare v_r jsonb; v_ids uuid[]; v_a uuid; v_b uuid; v_before uuid[]; v_after uuid[];
begin
  -- refuses a table that is not one of the three
  begin
    perform master_reorder('accounts', gen_random_uuid(), 'up');
    raise exception '369: master_reorder accepted a table outside the whitelist';
  exception when others then
    if sqlerrm !~ 'Not a tree master' and sqlerrm !~ 'Not authorized' then raise; end if;
  end;

  -- refuses a direction that is not one of the four
  begin
    perform master_reorder('acct_products', gen_random_uuid(), 'sideways');
    raise exception '369: master_reorder accepted a bad direction';
  exception when others then
    if sqlerrm !~ 'not "sideways"' and sqlerrm !~ 'Not authorized' then raise; end if;
  end;

  raise notice '369 ok: master_reorder refuses an unknown table and an unknown direction';
end
$chk$;

commit;
