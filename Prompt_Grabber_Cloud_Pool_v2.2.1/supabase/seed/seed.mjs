import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const AUTHOR_EMAIL = String(process.env.SEED_AUTHOR_EMAIL || '').trim().toLowerCase();
const BUCKET = 'prompt-markdown';
const CLEANUP = process.argv.includes('--cleanup');

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL)) {
  fail('Set SUPABASE_URL to your project URL, e.g. https://abc.supabase.co');
}
if (SERVICE_ROLE_KEY.length < 30) fail('Set SUPABASE_SERVICE_ROLE_KEY. Keep it outside the extension.');
if (!AUTHOR_EMAIL) fail('Set SEED_AUTHOR_EMAIL to a user who has already signed in once.');

const seedData = JSON.parse(await readFile(join(here, 'seed-data.json'), 'utf8'));
if (!Array.isArray(seedData) || !seedData.length) fail('seed-data.json is empty.');

const baseHeaders = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`
};

function fail(message) {
  console.error(`\nSeed error: ${message}\n`);
  process.exit(1);
}

async function api(path, { method = 'GET', body, headers = {}, allow404 = false } = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      ...baseHeaders,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok && !(allow404 && response.status === 404)) {
    let detail = '';
    try { detail = await response.text(); } catch {}
    throw new Error(`${method} ${path} -> ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function getAuthor() {
  const query = new URLSearchParams({
    select: 'id,email,display_name,role',
    email: `eq.${AUTHOR_EMAIL}`,
    limit: '1'
  });
  const rows = await api(`/rest/v1/profiles?${query}`);
  const author = Array.isArray(rows) ? rows[0] : null;
  if (!author) {
    fail(`No profile exists for ${AUTHOR_EMAIL}. Sign in with Google once, then rerun the seed.`);
  }
  if (author.role !== 'admin') {
    console.warn(`Warning: ${AUTHOR_EMAIL} is '${author.role}', not 'admin'. Seed still works via service role, but promote this user for normal admin UI testing.`);
  }
  return author;
}

async function ensureNiches() {
  const values = [
    {
      slug: 'excel',
      name: 'Excel',
      description: 'Cleaning, analysis, formulas, models, and spreadsheet workflows.',
      icon: 'X',
      sort_order: 10,
      active: true
    },
    {
      slug: 'word',
      name: 'Word',
      description: 'Document cleanup, proposals, formatting, and Word automation.',
      icon: 'W',
      sort_order: 20,
      active: true
    }
  ];

  for (const value of values) {
    const query = new URLSearchParams({ on_conflict: 'slug' });
    await api(`/rest/v1/niches?${query}`, {
      method: 'POST',
      body: value,
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }
    });
  }

  const query = new URLSearchParams({
    select: 'id,slug,name',
    slug: 'in.(excel,word)'
  });
  const rows = await api(`/rest/v1/niches?${query}`);
  return new Map((rows || []).map((row) => [row.slug, row]));
}

async function uploadMarkdown(path, markdown) {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(BUCKET)}/${encoded}`, {
    method: 'POST',
    headers: {
      ...baseHeaders,
      'Content-Type': 'text/markdown',
      'x-upsert': 'true'
    },
    body: markdown
  });
  if (!response.ok) throw new Error(`Storage upload ${path} -> ${response.status}: ${await response.text()}`);
}

async function deleteMarkdown(path) {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(BUCKET)}`, {
    method: 'DELETE',
    headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: [path] })
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Storage delete ${path} -> ${response.status}: ${await response.text()}`);
  }
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function upsertPrompt(record) {
  const query = new URLSearchParams({ on_conflict: 'id' });
  await api(`/rest/v1/pool_prompts?${query}`, {
    method: 'POST',
    body: record,
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }
  });
}

async function removePrompt(id) {
  const query = new URLSearchParams({ id: `eq.${id}` });
  await api(`/rest/v1/pool_prompts?${query}`, { method: 'DELETE' });
}

async function verifySeed() {
  const ids = seedData.map((item) => item.id).join(',');
  const query = new URLSearchParams({
    select: 'id,title,markdown_path,source,status,score,grab_count',
    id: `in.(${ids})`,
    order: 'title.asc'
  });
  const rows = await api(`/rest/v1/pool_prompts?${query}`);
  const found = new Map((rows || []).map((row) => [row.id, row]));
  const missing = seedData.filter((item) => !found.has(item.id));
  if (missing.length) throw new Error(`Metadata verification failed for ${missing.length} prompt(s).`);
  return rows;
}

const author = await getAuthor();
const niches = await ensureNiches();
if (!niches.has('excel') || !niches.has('word')) fail('Excel/Word niches were not created correctly.');

if (CLEANUP) {
  console.log(`Removing ${seedData.length} synthetic prompts...`);
  for (const item of seedData) {
    const path = `${item.niche}/${author.id}/${item.id}.md`;
    await deleteMarkdown(path);
    await removePrompt(item.id);
    console.log(`  removed ${item.title}`);
  }
  console.log('\nSynthetic Prompt Pool data removed.');
  process.exit(0);
}

console.log(`Seeding Prompt Pool as ${author.display_name || author.email} (${author.id})`);
console.log(`Files available: ${(await readdir(join(here, 'prompts'))).length}`);

for (const item of seedData) {
  const niche = niches.get(item.niche);
  if (!niche) throw new Error(`Unknown niche '${item.niche}' for ${item.title}`);
  const markdown = await readFile(join(here, 'prompts', item.file), 'utf8');
  const objectPath = `${item.niche}/${author.id}/${item.id}.md`;

  await uploadMarkdown(objectPath, markdown);
  await upsertPrompt({
    id: item.id,
    title: item.title,
    summary: item.summary,
    tags: item.tags,
    niche_id: niche.id,
    author_id: author.id,
    markdown_path: objectPath,
    content_hash: sha256(markdown),
    source: 'official',
    status: 'published',
    score: Number(item.score || 0),
    grab_count: Number(item.grab_count || 0)
  });
  console.log(`  seeded [${item.niche}] ${item.title}`);
}

const rows = await verifySeed();
console.log(`\nVerified ${rows.length}/${seedData.length} metadata rows.`);
console.log('Synthetic data is ready. Sign in through the extension and open Prompt Pool.');
