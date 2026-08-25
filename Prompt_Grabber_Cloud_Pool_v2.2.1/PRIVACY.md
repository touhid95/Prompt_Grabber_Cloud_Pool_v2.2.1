# Privacy Notice — Prompt Grabber v2.2.1

Prompt Grabber has two separate data modes: a **local workspace** and an **optional cloud Prompt Pool**.

## Local workspace

Prompt Grabber stores submitted prompt text, AI site name, capture time, page title, and—when enabled—the source page URL in the browser's local extension storage.

The extension also stores locally:

- Human-authored Rule Book entries and their on/off state
- IDs of prompts currently selected with Grab
- Local manual version history for saved rules
- Prompt edits and edit timestamps
- Local Notes, including note titles, bodies, and save timestamps
- Prompt Grabber settings

**Combine** joins selected prompt text without rewriting it.

**Compile** uses the browser-provided on-device `LanguageModel` when it is available. Selected prompts are provided to that local model so it can generate a revised compiled prompt. Active Rule Book instructions are included only when the user has explicitly switched them on. Rules are optional.

Prompt Grabber does not use a developer API key or a cloud AI fallback for Compile.

- No AI responses from ChatGPT, Claude, Gemini, or other supported sites are intentionally captured.
- No passwords or ordinary search fields are intentionally captured.
- Source URLs are stored without query parameters or URL fragments.
- Additional websites require explicit one-time permission from the user.
- Clicking **Grab now** reads user-authored messages currently loaded in the active conversation page so they can be saved locally. Assistant responses are not intentionally collected.

## Prompt editing

When a saved prompt is edited, the edited text and edit time are stored locally. The originally captured text may also be retained locally for duplicate detection so **Grab now** does not add the same chat message again.

## Notes

Notes are stored locally in `chrome.storage.local`. Note titles and bodies auto-save as the user types. Notes are not automatically included in Combine, Compile, or cloud sharing.

## Temporary Combine/Compile results

Temporary Combine/Compile previews are not stored as permanent Prompt Grabber outputs. They exist only in the open result window unless the user manually copies the text.

# Optional Cloud Prompt Pool

The Prompt Pool is opened by clicking the Prompt Grabber `P` logo.

Cloud functionality uses:

- Google sign-in through Supabase Auth
- Supabase Postgres for Prompt Pool metadata
- Supabase Storage for full prompt bodies stored as Markdown

Google authentication is required only for cloud Prompt Pool features. The existing local workspace remains usable without Google sign-in.

## What is sent to the cloud

Cloud data is sent only when the user performs an explicit cloud action, such as:

- signing in to the Prompt Pool
- browsing cloud prompts
- publishing a prompt
- voting
- grabbing/downloading a cloud prompt

Prompt Grabber does **not** automatically upload local prompt history.

When the user chooses **Share to Prompt Pool**, only that selected prompt plus the publication metadata the user provides is uploaded.

Published prompt data can include:

- prompt Markdown body
- title
- niche/category
- short description
- tags
- author profile identifier/display information
- vote score
- grab count
- creation time

## Google sign-in session

After Google sign-in completes through Supabase Auth, the extension stores the resulting Supabase session tokens in extension-local storage so the user can remain signed in and refresh the session when needed.

The extension does not request Google Drive, Gmail, Calendar, or other Google-product data for Prompt Pool sign-in.

## Cloud Prompt Pool visibility

Published Prompt Pool entries are visible to authenticated Prompt Pool users. Hidden/unpublished prompt Markdown is restricted by database and Storage access policies to its author or an administrator.

Prompt bodies use an object path structured as:

```text
{niche_slug}/{author_user_id}/{prompt_id}.md
```

## Voting

A signed-in user can have one current vote per cloud prompt. The extension uses a controlled database function to add, replace, or remove the user's vote and update the aggregate score.

## Cloud Grab

When the user clicks **Grab** on a cloud prompt, the Markdown body is downloaded from Supabase and copied into the user's local Prompt Grabber history. The local copy then behaves like other saved prompts for editing, Combine, and Compile.

## Deletion and control

Users can delete local prompts and notes and clear their local prompt history. Users can sign out of the Prompt Pool at any time.

Cloud Prompt Pool deletion/moderation capabilities depend on the Prompt Pool role and application controls provided by the owner/administrator.

## Developer / service credentials

The extension must contain only the Supabase public/publishable key. A Supabase `service_role` key must never be bundled with or exposed by the extension.

The optional synthetic seed script uses a service-role key only when run manually in an administrator's local terminal/environment. That key is not written into Prompt Grabber extension files.
