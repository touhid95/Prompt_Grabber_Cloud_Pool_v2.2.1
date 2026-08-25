-- Prompt Grabber Cloud Pool structural verification
-- Run in Supabase SQL Editor after schema.sql and optional synthetic seeding.

select 'profiles table' as check_name, to_regclass('public.profiles') is not null as ok
union all select 'niches table', to_regclass('public.niches') is not null
union all select 'pool_prompts table', to_regclass('public.pool_prompts') is not null
union all select 'prompt_votes table', to_regclass('public.prompt_votes') is not null
union all select 'prompt_pool_feed view', to_regclass('public.prompt_pool_feed') is not null;

select
  'prompt-markdown bucket' as check_name,
  exists(select 1 from storage.buckets where id = 'prompt-markdown' and public = false) as ok;

select
  'Excel + Word niches' as check_name,
  count(*) = 2 as ok,
  count(*) as found
from public.niches
where slug in ('excel', 'word') and active = true;

select
  'auth profile trigger' as check_name,
  exists (
    select 1
    from pg_trigger
    where tgname = 'on_auth_user_created' and not tgisinternal
  ) as ok;

select
  'vote RPC' as check_name,
  to_regprocedure('public.cast_prompt_vote(uuid,integer)') is not null as ok
union all select
  'grab RPC',
  to_regprocedure('public.increment_prompt_grab(uuid)') is not null;

select
  'RLS enabled: profiles' as check_name,
  relrowsecurity as ok
from pg_class where oid = 'public.profiles'::regclass
union all
select 'RLS enabled: niches', relrowsecurity from pg_class where oid = 'public.niches'::regclass
union all
select 'RLS enabled: pool_prompts', relrowsecurity from pg_class where oid = 'public.pool_prompts'::regclass
union all
select 'RLS enabled: prompt_votes', relrowsecurity from pg_class where oid = 'public.prompt_votes'::regclass;

select tablename, policyname, cmd
from pg_policies
where schemaname in ('public', 'storage')
  and tablename in ('profiles', 'niches', 'pool_prompts', 'prompt_votes', 'objects')
order by schemaname, tablename, policyname;

-- Synthetic seed status. It is OK for this to be zero if seed/seed.mjs was not run.
select
  count(*) filter (where id::text like '10000000-%' or id::text like '20000000-%') as synthetic_prompt_count,
  count(*) filter (where source = 'official') as official_prompt_count,
  count(*) filter (where status = 'published') as published_prompt_count
from public.pool_prompts;

-- Every metadata row should point to an existing Storage object.
select
  count(*) as missing_markdown_objects
from public.pool_prompts p
left join storage.objects o
  on o.bucket_id = 'prompt-markdown' and o.name = p.markdown_path
where o.id is null;

-- Every Prompt Pool Markdown object should have matching metadata.
select
  count(*) as orphan_markdown_objects
from storage.objects o
left join public.pool_prompts p on p.markdown_path = o.name
where o.bucket_id = 'prompt-markdown' and p.id is null;

-- OKF path consistency: niche/user/prompt.md must match metadata.
select
  count(*) as invalid_okf_paths
from public.pool_prompts p
join public.niches n on n.id = p.niche_id
where split_part(p.markdown_path, '/', 1) <> n.slug
   or split_part(p.markdown_path, '/', 2) <> p.author_id::text
   or split_part(p.markdown_path, '/', 3) <> p.id::text || '.md';
