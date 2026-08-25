# Prompt Grabber v2.2.1

Prompt Grabber is a Chrome/Edge extension for capturing, finding, editing, combining, and locally compiling prompts. Notes remain a lightweight secondary workspace. v2.2.1 adds a hardened optional **cloud Prompt Pool** backed by Supabase and Google sign-in.

## Main local workflow

1. Prompts are captured automatically when they are sent, or **Grab now** can collect the user prompts currently loaded in the open chat.
2. Find prompts with the popup date filter or Full History search/site/date filters.
3. Edit a saved prompt when needed.
4. Use the **Grab** icon to build a selection in the exact order you want.
5. Choose **Combine** or **Compile**.

### Combine

**Combine** is lossless. It joins selected prompt text exactly as saved and in selection order. It does not use AI or the Rule Book. The result opens in a temporary editable result sheet for review and copy.

### Compile

**Compile** uses the browser-provided local `LanguageModel` when available to turn selected prompts into one cohesive prompt.

- Compile works with **zero active rules**.
- Only Rule Book entries explicitly toggled ON are used.
- OFF rules are completely ignored.
- There is no paid/cloud AI fallback or developer API key for compilation.

## Rule Book

Rules are optional, manually authored compilation instructions. A rule may contain any combination of:

- Role
- Context / Goal
- MUST / MUST NOT / SHOULD constraints
- Output Format
- Correct example
- Incorrect example

New rules start OFF. Only toggled-on rules are sent to the local compiler.

## Notes

Notes are intentionally secondary to the prompt workflow. They support multiple local notes with optional titles, inline editing, delete, and automatic saving while typing. Notes are never included in Combine or Compile.

# Cloud Prompt Pool

The Prompt Pool is intentionally a hidden/secondary feature: **click the Prompt Grabber `P` logo** in the popup or Full History to open it.

The pool uses:

- Google sign-in through Supabase Auth
- Supabase Postgres for prompt metadata, niches, profiles, vote state, score, and grab counts
- Supabase Storage for the full prompt body as `.md` Markdown files
- Row Level Security for cloud access control

## Pool experience

The Prompt Pool uses an Apify-style category/niche layout:

- left-side niche navigation
- search
- prompt-card grid
- Excel and Word as initial niches
- new niches can be added by an admin
- official/curated and community prompts
- Reddit-style upvote/downvote
- popularity / newest / most-grabbed sorting

## Cloud sharing

A cloud-share icon is available on saved prompt cards.

Choosing **Share to Prompt Pool** opens the pool with that local prompt preloaded into the publish form. Publishing uploads **only that explicit prompt**. The rest of the user's local history is not synchronized or uploaded.

A published prompt has:

- Title
- Niche
- Short description
- Tags
- Author
- Vote score
- Grab count
- Markdown object path

## Grabbing from the cloud pool

Choosing **Grab** on a Prompt Pool card:

1. Downloads its Markdown body from Supabase Storage.
2. Saves it into the user's local Prompt Grabber history as a `Prompt Pool` source.
3. Adds it to the current Combine/Compile selection.
4. Avoids creating another local duplicate if the same cloud prompt was already grabbed.

This keeps the existing local workflow unchanged after a cloud grab.

## OKF-style Markdown storage

Prompt bodies use the requested object key/folder pattern:

```text
{niche_slug}/{author_user_id}/{prompt_id}.md
```

Example:

```text
excel/<user-uuid>/<prompt-uuid>.md
```

Postgres stores searchable metadata. Supabase Storage stores the full Markdown prompt body.

## Google authentication

Cloud features require Google sign-in. Local prompt capture, local history, Combine, Compile, Rule Book, and Notes continue to work without cloud sign-in.

The extension uses `chrome.identity.launchWebAuthFlow()` with the Supabase Google OAuth authorize endpoint and validates the final Chromium extension redirect before storing the Supabase session.

Cloud requests automatically refresh an expired/invalid Supabase access token once and retry the failed operation.

See `supabase/SETUP.md` for setup.

# Synthetic Prompt Pool data

A complete synthetic seed pack is included under:

```text
supabase/seed/
```

It contains **16 Markdown prompts**:

- 8 Excel prompts
- 8 Word prompts

The seed populates both:

- Supabase Postgres metadata
- the private `prompt-markdown` Storage bucket

This means the seeded cards can be opened and grabbed immediately after seeding; they are not metadata-only placeholders.

### Seed prerequisites

1. Run `supabase/schema.sql`.
2. Configure Google Auth.
3. Sign in once through Prompt Grabber so your `profiles` row exists.
4. Optionally promote that account to admin.
5. Run:

```bash
SUPABASE_URL="https://YOUR_PROJECT.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY" \
SEED_AUTHOR_EMAIL="you@example.com" \
node supabase/seed/seed.mjs
```

**Never place the service-role key in the extension.** It is used only by this local/admin seed script.

To remove the synthetic prompts:

```bash
SUPABASE_URL="https://YOUR_PROJECT.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY" \
SEED_AUTHOR_EMAIL="you@example.com" \
node supabase/seed/seed.mjs --cleanup
```

# Verification

After setup and optional seeding:

1. Run `supabase/verify_setup.sql` in Supabase SQL Editor.
2. Run the local extension test suite:

```bash
./tests/run-all.sh
```

The local suite checks:

- JavaScript syntax
- Chrome Manifest integrity
- popup/manager/pool asset references
- duplicate HTML IDs
- Google OAuth redirect parsing
- OAuth redirect validation
- session persistence
- refresh-on-401 behavior
- authenticated REST calls
- Storage upload/download/delete requests
- synthetic seed files and metadata definitions

## Security hardening in v2.2.1

- Vote writes are RPC-only so direct writes cannot desynchronize vote rows and aggregate score.
- Vote RPC locks the prompt row to avoid rapid-request score races.
- Storage reads are limited to published prompts, the author's own prompt, or admins.
- Markdown upload paths must follow niche/user/UUID.md structure.
- Prompt metadata must match the OKF object path.
- Cloud operations retry once after a 401 by refreshing the Supabase session.
- OAuth callback is validated against the exact `chromiumapp.org` redirect path generated by Chrome.
- Minimum Chrome version is now 106 because the extension uses Promise-based `chrome.identity` APIs.

## Supported capture sites

Built-in support includes ChatGPT, Claude, Gemini, Grok, Perplexity, Kimi, DeepSeek, Moonshot AI, and Thinker. Additional sites can be enabled from the popup after permission is granted.

## Install

1. Extract the extension folder.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the extension folder.
6. Reload existing AI tabs once.

Cloud setup is optional. If you want the Prompt Pool, configure `cloud-config.js` and follow `supabase/SETUP.md`.

## Local storage

The following remain in `chrome.storage.local`:

- prompt history
- edits and original text used for duplicate detection
- Rule Book
- current Grab selection
- Notes
- settings
- Supabase session tokens after cloud sign-in

Temporary Combine/Compile results are not persisted.

## Cloud storage

Only explicit cloud actions are remote:

- Google authentication
- opening/browsing the Prompt Pool
- publishing a prompt
- voting
- grabbing/downloading a cloud prompt

The extension does not automatically upload local prompt history.
