-- Bind offline synchronisation to the exact signed-in user, even during account changes.
create function public.sakhelwe_sync_snapshot(expected_user_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null or auth.uid() is distinct from expected_user_id then raise exception 'Account changed; sync stopped.'; end if;
 return public.sakhelwe_snapshot();
end $$;
revoke all on function public.sakhelwe_sync_snapshot(uuid) from public,anon;
grant execute on function public.sakhelwe_sync_snapshot(uuid) to authenticated;
create function public.sakhelwe_sync_post(kind text,payload jsonb,request_key uuid,expected_user_id uuid) returns uuid language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null or auth.uid() is distinct from expected_user_id then raise exception 'Account changed; sync stopped.'; end if;
 return public.sakhelwe_post(kind,payload,request_key);
end $$;
revoke all on function public.sakhelwe_sync_post(text,jsonb,uuid,uuid) from public,anon;
grant execute on function public.sakhelwe_sync_post(text,jsonb,uuid,uuid) to authenticated;
