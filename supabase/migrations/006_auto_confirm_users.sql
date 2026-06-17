-- Auto-confirm every new auth user so no email verification is ever required.
create or replace function public.auto_confirm_user()
returns trigger language plpgsql security definer set search_path = auth as $$
begin
  if new.email_confirmed_at is null then
    new.email_confirmed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_autoconfirm on auth.users;
create trigger on_auth_user_autoconfirm
  before insert on auth.users
  for each row execute function public.auto_confirm_user();

revoke all on function public.auto_confirm_user() from public, anon, authenticated;
