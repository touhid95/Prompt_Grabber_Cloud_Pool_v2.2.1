import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const seedRoot = join(root, 'supabase', 'seed');
const data = JSON.parse(await readFile(join(seedRoot, 'seed-data.json'), 'utf8'));
assert.ok(Array.isArray(data) && data.length >= 12);
assert.equal(new Set(data.map((item) => item.id)).size, data.length, 'seed prompt IDs must be unique');
assert.ok(data.some((item) => item.niche === 'excel'));
assert.ok(data.some((item) => item.niche === 'word'));

for (const item of data) {
  assert.match(item.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.ok(item.title.length > 3 && item.title.length <= 140);
  assert.ok(item.summary.length <= 320);
  assert.ok(Array.isArray(item.tags) && item.tags.length <= 12);
  const markdown = await readFile(join(seedRoot, 'prompts', item.file), 'utf8');
  assert.ok(markdown.trim().length > 80, `${item.file} is too short`);
  assert.ok(markdown.length <= 100000, `${item.file} exceeds extension prompt limit`);
}

console.log(`seed data tests: PASS (${data.length} prompts)`);
