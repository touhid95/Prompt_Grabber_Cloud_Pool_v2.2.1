# Prompt Grabber v2.2.1 — Cloud Pool QA Report

## Result

**Local/static cloud integration validation: PASS**

The existing local Prompt Grabber capture/Combine/Compile code remains unchanged. Cloud changes are isolated to the new Prompt Pool entry points and cloud modules.

## Issues found during the v2.2.0 review and fixed

1. **Chrome compatibility mismatch** — the manifest allowed Chrome 102 while the code awaited Promise-based `chrome.identity` APIs. Minimum version is now 106.
2. **OAuth callback trust** — the callback tokens were parsed without validating that the returned URL matched the exact Chromium redirect path. The redirect is now checked before session acceptance.
3. **Unexpected JWT expiry** — cloud requests could fail if Supabase invalidated a token before its locally stored expiry. REST and Storage calls now refresh once on HTTP 401 and retry.
4. **Vote score drift** — authenticated users had direct INSERT/UPDATE/DELETE grants on `prompt_votes`, which could bypass the RPC and desynchronize aggregate score. Vote writes are now RPC-only.
5. **Rapid vote race** — the vote RPC did not lock the prompt score row. It now locks the row before applying the delta.
6. **Over-broad Markdown read policy** — every authenticated user could read every object in the private bucket if the path was known/listed. Reads are now tied to published metadata, author ownership, or admin access.
7. **Weak OKF path validation** — upload/metadata policies did not fully verify the niche, user folder, and prompt UUID filename. They now do.
8. **Large vote-query URL** — loading votes built an `in.(...)` URL containing up to 250 UUIDs. The client now fetches the signed-in user's RLS-limited votes and filters locally.
9. **No complete database demo data** — v2.2.0 had initial niches only. v2.2.1 includes 16 real Markdown seed objects plus matching Postgres metadata.
10. **No repeatable verification pack** — v2.2.1 adds local tests and a Supabase verification SQL script.

## Synthetic dataset

- 16 prompts total
- 8 Excel
- 8 Word
- each prompt has a real `.md` body
- deterministic UUIDs make the seed idempotent
- synthetic score/grab metrics exercise Popular and Most Grabbed sorting
- seed cleanup mode removes the same records and objects

## Local automated tests

Executed:

```text
./tests/run-all.sh
```

Result:

```text
syntax: PASS ai-compiler.js
syntax: PASS background.js
syntax: PASS capture-core.js
syntax: PASS cloud-client.js
syntax: PASS cloud-config.js
syntax: PASS content.js
syntax: PASS manager.js
syntax: PASS pool.js
syntax: PASS popup.js
cloud-client tests: PASS
static integrity tests: PASS
seed data tests: PASS (16 prompts)
all local tests: PASS
```

## Existing local feature regression check

The following files are byte-for-byte unchanged from the supplied v2.1 implementation:

- `ai-compiler.js`
- `background.js`
- `capture-core.js`
- `content.js`
- `content.css`

Popup/Full History changes are limited to:

- clickable `P` logo → Prompt Pool
- Share-to-Pool action on prompt cards

## Supabase verification after live setup

Run `supabase/verify_setup.sql` after `schema.sql` and optional seeding.

For a seeded environment, important expected values are:

- synthetic prompt count: 16
- missing Markdown objects: 0
- orphan Markdown objects: 0
- invalid OKF paths: 0
- RLS: enabled on all four public cloud tables

## Live OAuth / cloud boundary

A true end-to-end Google consent + real Supabase transaction cannot be executed without the actual Supabase project URL/key, Google provider configuration, and Chrome extension redirect URL.

The OAuth logic itself was tested using a synthetic `launchWebAuthFlow` callback, including:

- authorize URL construction
- Chromium redirect validation
- implicit session token parsing
- session persistence
- refresh token flow
- automatic retry after 401

Final acceptance still requires one real browser sign-in using the checklist in `supabase/SETUP.md`.
