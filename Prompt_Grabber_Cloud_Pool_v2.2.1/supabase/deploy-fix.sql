-- Fix 1: Storage insert policy - remove cross-schema EXISTS check (known Supabase Storage limitation)
drop policy if exists "prompt markdown insert own folder" on storage.objects;
create policy "prompt markdown insert own folder" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'prompt-markdown'
  and (storage.foldername(name))[2] = auth.uid()::text
  and storage.filename(name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.md$'
);

-- Fix 2: pool_prompts insert policy - simple, unambiguous check only
drop policy if exists "pool prompts insert own" on public.pool_prompts;
create policy "pool prompts insert own" on public.pool_prompts
for insert to authenticated with check (author_id = auth.uid());
