import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const source = await readFile(join(root, 'cloud-client.js'), 'utf8');

function makeContext({ fetchImpl, launchUrl, initialStorage = {} } = {}) {
  const storage = { ...initialStorage };
  const redirect = 'https://abcdefghijklmnop.chromiumapp.org/supabase-auth';
  const context = {
    URL,
    URLSearchParams,
    Response,
    Request,
    Headers,
    TextEncoder,
    TextDecoder,
    console,
    setTimeout,
    clearTimeout,
    crypto: globalThis.crypto,
    fetch: fetchImpl,
    PromptGrabberCloudConfig: {
      supabaseUrl: 'https://demo-project.supabase.co',
      publishableKey: 'sb_publishable_123456789012345678901234567890',
      markdownBucket: 'prompt-markdown'
    },
    chrome: {
      storage: {
        local: {
          async get(key) {
            if (typeof key === 'string') return { [key]: storage[key] };
            const out = {};
            for (const name of key || []) out[name] = storage[name];
            return out;
          },
          async set(values) { Object.assign(storage, values); },
          async remove(key) {
            for (const name of Array.isArray(key) ? key : [key]) delete storage[name];
          }
        }
      },
      identity: {
        getRedirectURL(path = '') { return `https://abcdefghijklmnop.chromiumapp.org/${path}`; },
        async launchWebAuthFlow(details) {
          context.__lastAuthDetails = details;
          return launchUrl;
        }
      }
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'cloud-client.js' });
  return { context, storage, Cloud: context.PromptGrabberCloud, redirect };
}

async function testOAuthImplicitFlow() {
  const redirect = 'https://abcdefghijklmnop.chromiumapp.org/supabase-auth';
  const finalUrl = `${redirect}#access_token=access123&refresh_token=refresh123&expires_in=3600&token_type=bearer`;
  const requests = [];
  const { Cloud, storage, context } = makeContext({
    launchUrl: finalUrl,
    fetchImpl: async (url, init = {}) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: 'user-1', email: 'user@example.com' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }
  });

  const session = await Cloud.signInWithGoogle();
  assert.equal(session.user.id, 'user-1');
  assert.equal(storage.cloudSession.access_token, 'access123');
  const authUrl = new URL(context.__lastAuthDetails.url);
  assert.equal(authUrl.pathname, '/auth/v1/authorize');
  assert.equal(authUrl.searchParams.get('provider'), 'google');
  assert.equal(authUrl.searchParams.get('redirect_to'), redirect);
  assert.equal(requests.length, 1);
}

async function testRedirectValidation() {
  const { Cloud } = makeContext({ fetchImpl: async () => new Response('{}', { status: 200 }) });
  assert.throws(
    () => Cloud.parseAuthRedirect('https://wrong.chromiumapp.org/supabase-auth#access_token=a&refresh_token=b', 'https://abcdefghijklmnop.chromiumapp.org/supabase-auth'),
    /Unexpected OAuth redirect/
  );
}

async function testAutomaticRefreshOn401() {
  const calls = [];
  const storedSession = {
    access_token: 'old-access',
    refresh_token: 'refresh-token',
    expires_at: Date.now() + 600_000,
    user: { id: 'user-1' }
  };
  const { Cloud, storage } = makeContext({
    initialStorage: { cloudSession: storedSession },
    fetchImpl: async (url, init = {}) => {
      const target = String(url);
      calls.push({ target, init });
      if (target.includes('/rest/v1/niches')) {
        const auth = init.headers.Authorization;
        if (auth === 'Bearer old-access') return new Response(JSON.stringify({ message: 'JWT expired' }), { status: 401 });
        if (auth === 'Bearer new-access') return new Response(JSON.stringify([{ id: 'n1' }]), { status: 200 });
      }
      if (target.includes('/auth/v1/token?grant_type=refresh_token')) {
        return new Response(JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, user: { id: 'user-1' } }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${target}`);
    }
  });

  const rows = await Cloud.rest('niches', { query: { select: 'id' } });
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [{ id: 'n1' }]);
  assert.equal(storage.cloudSession.access_token, 'new-access');
  assert.equal(calls.filter((call) => call.target.includes('/rest/v1/niches')).length, 2);
  assert.equal(calls.filter((call) => call.target.includes('/auth/v1/token')).length, 1);
}

async function testStorageOperations() {
  const seen = [];
  const session = { access_token: 'access', refresh_token: 'refresh', expires_at: Date.now() + 600_000, user: { id: 'user-1' } };
  const { Cloud } = makeContext({
    initialStorage: { cloudSession: session },
    fetchImpl: async (url, init = {}) => {
      const target = String(url);
      seen.push({ target, init });
      if (init.method === 'POST' && target.includes('/storage/v1/object/prompt-markdown/')) {
        return new Response(JSON.stringify({ Key: 'excel/user-1/prompt.md' }), { status: 200 });
      }
      if ((!init.method || init.method === 'GET') && target.includes('/storage/v1/object/authenticated/')) {
        return new Response('# Prompt\nHello', { status: 200, headers: { 'content-type': 'text/markdown' } });
      }
      if (init.method === 'DELETE') return new Response('{}', { status: 200 });
      throw new Error(`Unexpected storage fetch: ${target}`);
    }
  });

  await Cloud.uploadMarkdown('excel/user-1/prompt.md', '# Prompt\nHello');
  const text = await Cloud.downloadMarkdown('excel/user-1/prompt.md');
  const removed = await Cloud.deleteMarkdown('excel/user-1/prompt.md');
  assert.equal(text, '# Prompt\nHello');
  assert.equal(removed, true);
  const upload = seen.find((item) => item.init.method === 'POST');
  assert.equal(upload.init.headers['Content-Type'], 'text/markdown');
  assert.equal(upload.init.headers['x-upsert'], 'false');
}

async function testHealthCheckSignedOut() {
  const { Cloud } = makeContext({ fetchImpl: async () => { throw new Error('should not fetch'); } });
  const result = await Cloud.healthCheck();
  assert.equal(result.ok, true);
  assert.equal(result.configured, true);
  assert.equal(result.authenticated, false);
}

await testOAuthImplicitFlow();
await testRedirectValidation();
await testAutomaticRefreshOn401();
await testStorageOperations();
await testHealthCheckSignedOut();
console.log('cloud-client tests: PASS');
