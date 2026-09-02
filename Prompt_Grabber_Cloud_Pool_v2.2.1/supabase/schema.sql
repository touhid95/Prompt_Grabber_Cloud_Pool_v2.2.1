-- Prompt Grabber v2.2 — Supabase Prompt Pool
-- Run once in Supabase SQL Editor.
-- Uses Auth + Postgres + Storage. Never expose service_role credentials in the extension.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null default 'Prompt Grabber user',
  avatar_url text,
  role text not null default 'member' check (role in ('member', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.niches (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null unique,
  description text not null default '',
  icon text not null default '✦',
  sort_order integer not null default 100,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pool_prompts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 140),
  summary text not null default '' check (char_length(summary) <= 320),
  tags text[] not null default '{}',
  niche_id uuid not null references public.niches(id) on delete restrict,
  author_id uuid not null references public.profiles(id) on delete cascade,
  markdown_path text not null unique,
  content_hash text,
  source text not null default 'community' check (source in ('community', 'official')),
  status text not null default 'published' check (status in ('published', 'hidden')),
  score integer not null default 0,
  grab_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.prompt_votes (
  prompt_id uuid not null references public.pool_prompts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (prompt_id, user_id)
);

create index if not exists pool_prompts_niche_idx on public.pool_prompts(niche_id, created_at desc);
create index if not exists pool_prompts_score_idx on public.pool_prompts(score desc, created_at desc);
create index if not exists pool_prompts_grab_idx on public.pool_prompts(grab_count desc, created_at desc);
create index if not exists prompt_votes_user_idx on public.prompt_votes(user_id, prompt_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(coalesce(new.email, 'Prompt Grabber user'), '@', 1)),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = coalesce(nullif(public.profiles.display_name, ''), excluded.display_name),
    avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function public.handle_new_user();

-- Backfill profiles for Google users who existed before this schema was installed.
insert into public.profiles (id, email, display_name, avatar_url)
select
  id,
  email,
  coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', split_part(coalesce(email, 'Prompt Grabber user'), '@', 1)),
  coalesce(raw_user_meta_data->>'avatar_url', raw_user_meta_data->>'picture')
from auth.users
on conflict (id) do nothing;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Flat feed for an Apify-style prompt-card UI.
create or replace view public.prompt_pool_feed
with (security_invoker = true)
as
select
  p.id,
  p.title,
  p.summary,
  p.tags,
  p.niche_id,
  n.slug as niche_slug,
  n.name as niche_name,
  n.icon as niche_icon,
  p.author_id,
  pr.display_name as author_name,
  pr.avatar_url as author_avatar,
  p.markdown_path,
  p.source,
  p.score,
  p.grab_count,
  p.created_at
from public.pool_prompts p
join public.niches n on n.id = p.niche_id
join public.profiles pr on pr.id = p.author_id
where p.status = 'published' and n.active = true;

create or replace function public.cast_prompt_vote(p_prompt_id uuid, p_value integer)
returns table(score integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  old_value integer := 0;
  delta integer := 0;
  next_score integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_value not in (-1, 1) then
    raise exception 'Vote must be -1 or 1';
  end if;

  -- Lock the prompt row so two rapid vote requests cannot race the aggregate score.
  select pp.score into next_score
  from public.pool_prompts pp
  where pp.id = p_prompt_id and pp.status = 'published'
  for update;
  if not found then raise exception 'Prompt not found'; end if;

  select pv.value into old_value
  from public.prompt_votes pv
  where pv.prompt_id = p_prompt_id and pv.user_id = auth.uid()
  for update;

  if found and old_value = p_value then
    delete from public.prompt_votes
    where prompt_id = p_prompt_id and user_id = auth.uid();
    delta := -old_value;
  else
    if not found then old_value := 0; end if;
    insert into public.prompt_votes (prompt_id, user_id, value)
    values (p_prompt_id, auth.uid(), p_value)
    on conflict (prompt_id, user_id)
    do update set value = excluded.value, updated_at = now();
    delta := p_value - old_value;
  end if;

  update public.pool_prompts as pp
  set score = pp.score + delta, updated_at = now()
  where pp.id = p_prompt_id
  returning pp.score into next_score;

  return query select next_score;
end;
$$;

create or replace function public.increment_prompt_grab(p_prompt_id uuid)
returns table(grab_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  update public.pool_prompts as pp
  set grab_count = pp.grab_count + 1
  where pp.id = p_prompt_id and pp.status = 'published'
  returning pp.grab_count into next_count;
  if next_count is null then raise exception 'Prompt not found'; end if;
  return query select next_count;
end;
$$;

create or replace function public.publish_prompt(
  p_id uuid,
  p_title text,
  p_summary text,
  p_tags text[],
  p_niche_id uuid,
  p_markdown_path text,
  p_content_hash text,
  p_source text
)
returns table(id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_source = 'official' and not public.is_admin() then
    raise exception 'Only admins can publish official prompts';
  end if;
  if not exists (
    select 1 from public.niches n
    where n.id = p_niche_id and n.active = true
  ) then
    raise exception 'Niche not found or inactive';
  end if;
  return query
  insert into public.pool_prompts
    (id, title, summary, tags, niche_id, author_id, markdown_path, content_hash, source, status)
  values
    (p_id, p_title, p_summary, p_tags, p_niche_id, auth.uid(), p_markdown_path, p_content_hash, p_source, 'published')
  returning pool_prompts.id, pool_prompts.created_at;
end;
$$;

alter table public.profiles enable row level security;
alter table public.niches enable row level security;
alter table public.pool_prompts enable row level security;
alter table public.prompt_votes enable row level security;

-- Profiles: authenticated users may see public profile fields; members may edit only their own display information.
drop policy if exists "profiles read for members" on public.profiles;
create policy "profiles read for members" on public.profiles
for select to authenticated using (true);

drop policy if exists "profiles update self" on public.profiles;
create policy "profiles update self" on public.profiles
for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Niches: all signed-in users can browse, only admins can manage.
drop policy if exists "niches read active" on public.niches;
create policy "niches read active" on public.niches
for select to authenticated using (active = true or public.is_admin());

drop policy if exists "niches admin insert" on public.niches;
create policy "niches admin insert" on public.niches
for insert to authenticated with check (public.is_admin());

drop policy if exists "niches admin update" on public.niches;
create policy "niches admin update" on public.niches
for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "niches admin delete" on public.niches;
create policy "niches admin delete" on public.niches
for delete to authenticated using (public.is_admin());

-- Pool prompts: signed-in users see published prompts. Authors may publish community prompts; admins may mark official prompts.
drop policy if exists "pool prompts read published" on public.pool_prompts;
create policy "pool prompts read published" on public.pool_prompts
for select to authenticated using (status = 'published' or author_id = auth.uid() or public.is_admin());

drop policy if exists "pool prompts insert own" on public.pool_prompts;
create policy "pool prompts insert own" on public.pool_prompts
for insert to authenticated with check (author_id = auth.uid());

drop policy if exists "pool prompts update own" on public.pool_prompts;
create policy "pool prompts update own" on public.pool_prompts
for update to authenticated using (author_id = auth.uid() or public.is_admin())
with check (author_id = auth.uid() or public.is_admin());

drop policy if exists "pool prompts delete own" on public.pool_prompts;
create policy "pool prompts delete own" on public.pool_prompts
for delete to authenticated using (author_id = auth.uid() or public.is_admin());

-- Votes: users may read only their own vote row. All vote writes go through the
-- security-definer RPC so score and vote state cannot drift apart.
drop policy if exists "votes read own" on public.prompt_votes;
create policy "votes read own" on public.prompt_votes
for select to authenticated using (user_id = auth.uid());

drop policy if exists "votes insert own" on public.prompt_votes;
drop policy if exists "votes update own" on public.prompt_votes;
drop policy if exists "votes delete own" on public.prompt_votes;

-- Grants used by PostgREST. Sensitive score/grab counters and vote writes are changed through RPC only.
grant usage on schema public to authenticated;
grant select on public.niches, public.pool_prompts, public.prompt_votes, public.prompt_pool_feed to authenticated;
grant select (id, display_name, avatar_url, role, created_at, updated_at) on public.profiles to authenticated;
grant insert on public.niches, public.pool_prompts to authenticated;
grant delete on public.niches, public.pool_prompts to authenticated;
grant update (display_name, avatar_url, updated_at) on public.profiles to authenticated;
grant update (name, description, icon, sort_order, active, updated_at) on public.niches to authenticated;
grant update (title, summary, tags, status, updated_at) on public.pool_prompts to authenticated;
revoke insert, update, delete on public.prompt_votes from authenticated;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
revoke execute on function public.cast_prompt_vote(uuid, integer) from public, anon;
revoke execute on function public.increment_prompt_grab(uuid) from public, anon;
revoke execute on function public.publish_prompt(uuid, text, text, text[], uuid, text, text, text) from public, anon;
grant execute on function public.cast_prompt_vote(uuid, integer) to authenticated;
grant execute on function public.increment_prompt_grab(uuid) to authenticated;
grant execute on function public.publish_prompt(uuid, text, text, text[], uuid, text, text, text) to authenticated;

-- Private Markdown bucket. Files use the OKF-style path:
--   {niche_slug}/{author_user_id}/{prompt_id}.md
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('prompt-markdown', 'prompt-markdown', false, 1048576, array['text/markdown', 'text/plain'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage RLS. A signed-in user can read Markdown only when the matching
-- Prompt Pool metadata is published, authored by them, or they are an admin.
drop policy if exists "prompt markdown read" on storage.objects;
create policy "prompt markdown read" on storage.objects
for select to authenticated
using (
  bucket_id = 'prompt-markdown'
  and (
    (storage.foldername(name))[2] = auth.uid()::text
    or public.is_admin()
    or exists (
      select 1 from public.pool_prompts p
      where p.markdown_path = name
        and p.status = 'published'
    )
  )
);

drop policy if exists "prompt markdown insert own folder" on storage.objects;
create policy "prompt markdown insert own folder" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'prompt-markdown'
  and (storage.foldername(name))[2] = auth.uid()::text
  and storage.filename(name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.md$'
);

drop policy if exists "prompt markdown update own folder" on storage.objects;
create policy "prompt markdown update own folder" on storage.objects
for update to authenticated
using (
  bucket_id = 'prompt-markdown'
  and ((storage.foldername(name))[2] = auth.uid()::text or public.is_admin())
)
with check (
  bucket_id = 'prompt-markdown'
  and ((storage.foldername(name))[2] = auth.uid()::text or public.is_admin())
);

drop policy if exists "prompt markdown delete own folder" on storage.objects;
create policy "prompt markdown delete own folder" on storage.objects
for delete to authenticated
using (
  bucket_id = 'prompt-markdown'
  and ((storage.foldername(name))[2] = auth.uid()::text or public.is_admin())
);

-- Initial niches requested for the first Prompt Pool.
insert into public.niches (slug, name, description, icon, sort_order)
values
  ('excel', 'Excel', 'Cleaning, analysis, formulas, models, and spreadsheet workflows.', 'X', 10),
  ('word', 'Word', 'Document cleanup, proposals, formatting, and Word automation.', 'W', 20)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  sort_order = excluded.sort_order,
  active = true;

-- AFTER YOUR FIRST GOOGLE SIGN-IN, promote the owner/admin manually:
-- update public.profiles set role = 'admin' where email = 'you@company.com';

-- ── Cross-device sync tables ─────────────────────────────────────────────────

create table if not exists public.user_notes (
  id         uuid primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  title      text not null default '' check (char_length(title) <= 120),
  body       text not null default '' check (char_length(body) <= 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists user_notes_user_updated_idx on public.user_notes (user_id, updated_at desc);

create table if not exists public.user_prompts (
  id             uuid primary key,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  text           text not null check (char_length(text) <= 100000),
  site_id        text not null default '',
  site_name      text not null default '',
  url            text not null default '',
  page_title     text not null default '',
  capture_method text not null default '',
  created_at     timestamptz not null,
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists user_prompts_user_created_idx on public.user_prompts (user_id, created_at desc);

create table if not exists public.user_rules (
  id                uuid primary key,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  title             text not null default '',
  role              text not null default '',
  context           text not null default '',
  must              text not null default '',
  must_not          text not null default '',
  should            text not null default '',
  output_format     text not null default '',
  correct_example   text not null default '',
  incorrect_example text not null default '',
  active            boolean not null default true,
  versions          jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create index if not exists user_rules_user_updated_idx on public.user_rules (user_id, updated_at desc);

alter table public.user_notes   enable row level security;
alter table public.user_prompts enable row level security;
alter table public.user_rules   enable row level security;

-- Owner-only access for both tables
drop policy if exists "user notes owner" on public.user_notes;
create policy "user notes owner" on public.user_notes
for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "user prompts owner" on public.user_prompts;
create policy "user prompts owner" on public.user_prompts
for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "user rules owner" on public.user_rules;
create policy "user rules owner" on public.user_rules
for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Grants
grant select, insert, update, delete on public.user_notes   to authenticated;
grant select, insert, update, delete on public.user_prompts to authenticated;
grant select, insert, update, delete on public.user_rules   to authenticated;

-- sync_notes RPC: batch-upsert notes for the current user (newest updated_at wins)
create or replace function public.sync_notes(items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare item jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  for item in select * from jsonb_array_elements(items) loop
    insert into public.user_notes (id, user_id, title, body, created_at, updated_at, deleted_at)
    values (
      (item->>'id')::uuid, auth.uid(),
      coalesce(item->>'title', ''),
      coalesce(item->>'body', ''),
      coalesce((item->>'createdAt')::timestamptz, now()),
      coalesce((item->>'updatedAt')::timestamptz, now()),
      (item->>'deletedAt')::timestamptz
    )
    on conflict (id) do update set
      title = excluded.title, body = excluded.body,
      updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
    where excluded.updated_at >= user_notes.updated_at;
  end loop;
end; $$;

-- sync_prompts RPC: batch-upsert prompts, then trim to 100 newest per user
create or replace function public.sync_prompts(items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare item jsonb; excess integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  for item in select * from jsonb_array_elements(items) loop
    insert into public.user_prompts
      (id, user_id, text, site_id, site_name, url, page_title, capture_method, created_at, updated_at, deleted_at)
    values (
      (item->>'id')::uuid, auth.uid(),
      coalesce(item->>'text', ''),
      coalesce(item->>'siteId', ''),
      coalesce(item->>'siteName', ''),
      coalesce(item->>'url', ''),
      coalesce(item->>'pageTitle', ''),
      coalesce(item->>'captureMethod', ''),
      coalesce((item->>'createdAt')::timestamptz, now()),
      coalesce((item->>'editedAt')::timestamptz, (item->>'createdAt')::timestamptz, now()),
      (item->>'deletedAt')::timestamptz
    )
    on conflict (id) do update set
      text = excluded.text, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
    where excluded.updated_at >= user_prompts.updated_at;
  end loop;
  -- Enforce 100-prompt limit: delete oldest beyond the cap
  select count(*) - 100 into excess
  from public.user_prompts where user_id = auth.uid() and deleted_at is null;
  if excess > 0 then
    delete from public.user_prompts where id in (
      select id from public.user_prompts
      where user_id = auth.uid() and deleted_at is null
      order by created_at asc limit excess
    );
  end if;
end; $$;

-- sync_rules RPC: batch-upsert rules for the current user
create or replace function public.sync_rules(items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare item jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  for item in select * from jsonb_array_elements(items) loop
    insert into public.user_rules (
      id, user_id, title, role, context, must, must_not, should, output_format,
      correct_example, incorrect_example, active, versions, created_at, updated_at, deleted_at
    )
    values (
      (item->>'id')::uuid, auth.uid(),
      coalesce(item->>'title', ''),
      coalesce(item->>'role', ''),
      coalesce(item->>'context', ''),
      coalesce(item->>'must', ''),
      coalesce(item->>'mustNot', ''),
      coalesce(item->>'should', ''),
      coalesce(item->>'outputFormat', ''),
      coalesce(item->>'correctExample', ''),
      coalesce(item->>'incorrectExample', ''),
      coalesce((item->>'active')::boolean, true),
      coalesce(item->'versions', '[]'::jsonb),
      coalesce((item->>'createdAt')::timestamptz, now()),
      coalesce((item->>'updatedAt')::timestamptz, now()),
      (item->>'deletedAt')::timestamptz
    )
    on conflict (id) do update set
      title = excluded.title, role = excluded.role, context = excluded.context,
      must = excluded.must, must_not = excluded.must_not, should = excluded.should,
      output_format = excluded.output_format, correct_example = excluded.correct_example,
      incorrect_example = excluded.incorrect_example, active = excluded.active,
      versions = excluded.versions,
      updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
    where excluded.updated_at >= user_rules.updated_at;
  end loop;
end; $$;

revoke execute on function public.sync_notes(jsonb) from public, anon;
revoke execute on function public.sync_prompts(jsonb) from public, anon;
revoke execute on function public.sync_rules(jsonb) from public, anon;
grant execute on function public.sync_notes(jsonb) to authenticated;
grant execute on function public.sync_prompts(jsonb) to authenticated;
grant execute on function public.sync_rules(jsonb) to authenticated;
