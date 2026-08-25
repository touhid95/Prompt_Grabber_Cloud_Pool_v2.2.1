import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function htmlIds(html) {
  return new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
}

function assertQuerySelectorIdsExist(js, ids, filename) {
  for (const match of js.matchAll(/querySelector\(["']#([^"']+)["']\)/g)) {
    assert.ok(ids.has(match[1]), `${filename} references missing #${match[1]}`);
  }
}
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.ok(manifest.permissions.includes('identity'));
assert.ok(manifest.permissions.includes('storage'));
assert.ok(Number(manifest.minimum_chrome_version) >= 106, 'minimum Chrome must support Promise identity APIs');

for (const page of ['popup.html', 'manager.html', 'pool.html']) {
  const html = await readFile(join(root, page), 'utf8');
  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
  for (const script of scripts) await access(join(root, script));
  const styles = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map((m) => m[1]);
  for (const style of styles) await access(join(root, style));

  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, `${page} contains duplicate element ids`);
}

for (const page of ['popup.html', 'manager.html']) {
  const html = await readFile(join(root, page), 'utf8');
  assert.match(html, /id="openPromptPoolButton"/, `${page} must expose the logo Prompt Pool entry point`);
}

for (const [page, script] of [['popup.html', 'popup.js'], ['manager.html', 'manager.js'], ['pool.html', 'pool.js']]) {
  const html = await readFile(join(root, page), 'utf8');
  const js = await readFile(join(root, script), 'utf8');
  assertQuerySelectorIdsExist(js, htmlIds(html), script);
}

const privacy = await readFile(join(root, 'PRIVACY.md'), 'utf8');
assert.match(privacy, /Supabase/i);
assert.match(privacy, /Google/i);
assert.match(privacy, /explicit/i);

console.log('static integrity tests: PASS');
