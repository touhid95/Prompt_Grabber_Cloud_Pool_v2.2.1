# Prompt Grabber Cloud Prompt Pool — v2.2.1 Audit Notes

## Scope retained

The cloud layer remains optional. Existing local capture, Grab now, editing, selection, Combine, Compile, Rule Book, Notes, filtering, and Full History behavior is preserved.

## Entry point

Click the `P` logo in popup or Full History to open `pool.html`.

## Cloud stack

- Google OAuth through Supabase Auth
- Supabase Postgres for profiles, niches, prompt metadata, votes, scores, and grab counts
- private Supabase Storage bucket for Markdown prompt bodies
- OKF-style object path: `{niche_slug}/{author_user_id}/{prompt_id}.md`

## v2.2.1 double-check changes

1. OAuth callback validates the exact Chromium redirect URL before accepting tokens.
2. OAuth/session tests cover synthetic Google redirect, session persistence, and refresh-on-401 behavior.
3. Cloud REST/Storage operations automatically retry once after refreshing an invalid access token.
4. Minimum Chrome version increased to 106 for Promise-based `chrome.identity` usage.
5. Vote writes are RPC-only; direct table writes are revoked so score cannot drift from user vote rows.
6. Vote RPC locks the prompt row to reduce race conditions from rapid requests.
7. Storage SELECT policy no longer exposes every object to every authenticated user; it allows published content, the author's own content, or admin access.
8. Upload RLS validates niche folder, signed-in user folder, and UUID Markdown filename.
9. `pool_prompts` insert RLS validates metadata against the OKF object path.
10. Vote loading no longer builds a potentially oversized `in.(250 UUIDs)` URL.
11. Added a complete 16-prompt synthetic dataset with actual Markdown files for Excel and Word.
12. Added idempotent local/admin Supabase seeder and cleanup mode.
13. Added `verify_setup.sql` to detect missing tables, bucket, RLS, missing objects, orphan objects, and invalid OKF paths.
14. Added dependency-free local test suite under `tests/`.

## Local validation completed

`tests/run-all.sh` validates:

- syntax of every extension JavaScript file
- manifest structure
- required identity/storage permissions
- minimum Chrome version
- HTML asset references and duplicate IDs
- OAuth redirect parsing/validation
- automatic token refresh and retry
- authenticated REST requests
- Markdown upload/download/delete request construction
- synthetic seed definitions and all 16 Markdown files

## Live test boundary

A real Google consent screen and real Supabase transaction cannot be completed until actual project credentials, Google provider configuration, and the final extension redirect URL are supplied. The included tests simulate the OAuth/session flow, but final production acceptance should still follow the browser checklist in `supabase/SETUP.md`.
