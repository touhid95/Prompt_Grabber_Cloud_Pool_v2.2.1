# Supabase + Google Setup — Prompt Grabber v2.2.1

## 1. Create / choose a Supabase project

You need the project URL and the **publishable/anon key**. Do not use the `service_role` key in the extension.

Open `cloud-config.js` and replace:

```js
supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
publishableKey: "YOUR_SUPABASE_PUBLISHABLE_KEY"
```

For production, replace the broad Supabase host permission in `manifest.json` with your exact project hostname when practical.

## 2. Run the database setup

Open **Supabase → SQL Editor** and run:

```text
supabase/schema.sql
```

It creates:

- `profiles`
- `niches`
- `pool_prompts`
- `prompt_votes`
- `prompt_pool_feed`
- vote/grab RPC functions
- Row Level Security policies
- private `prompt-markdown` Storage bucket
- initial `Excel` and `Word` niches

## 3. Enable Google in Supabase Auth

In **Supabase → Authentication → Providers → Google**, enable Google and add the Google Web OAuth Client ID + Client Secret from Google Cloud.

In Google Cloud, the authorized redirect URI for the Google OAuth client is the **Supabase callback URL** shown by the Supabase Google provider, normally:

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

Prompt Grabber does not send Google directly to the Chrome extension. Google returns to Supabase first; Supabase then redirects the completed user session to the extension.

## 4. Add the Chrome extension redirect to Supabase

Prompt Grabber finishes the Supabase OAuth flow at:

```text
https://<extension-id>.chromiumapp.org/supabase-auth
```

**Important:** When a Chrome extension is installed unpacked (developer/sideloaded mode),
each browser profile generates a **different Extension ID**. This means the redirect URL
changes per machine. To sign in from multiple machines without having to add each redirect
URL individually, use the **wildcard entry**:

```text
https://*.chromiumapp.org/supabase-auth
```

Add this wildcard to:
**Supabase → Authentication → URL Configuration → Redirect URLs**

This covers every unpacked Extension ID. The `/supabase-auth` path suffix is still
enforced by the extension code, so no other extension can intercept the OAuth callback.

> **Note for Chrome Web Store releases:** A published extension receives a stable, permanent
> Extension ID from Google. In that case you can (and should) use the exact URL instead of
> the wildcard:
> ```
> https://<stable-extension-id>.chromiumapp.org/supabase-auth
> ```

Get the exact URL for the current machine by loading the extension and using the Prompt Pool
sign-in page's **"Copy this machine's redirect URL"** button, or from an extension console:

```js
chrome.identity.getRedirectURL("supabase-auth")
```

## 5. Sign in once

Open Prompt Grabber → click the `P` logo → **Continue with Google**.

Successful sign-in should create/update your row in `public.profiles` through the auth trigger.

## 6. Make your owner account admin

Run once after your first sign-in:

```sql
update public.profiles
set role = 'admin'
where email = 'YOUR_GOOGLE_EMAIL';
```

Admins can create new niches and mark published prompts as **Official**.

## 7. Populate synthetic test data

The included seed creates 16 complete prompt records and uploads 16 corresponding Markdown objects.

Use the Supabase **service-role key only in your terminal/admin environment**:

```bash
SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY" \
SEED_AUTHOR_EMAIL="YOUR_GOOGLE_EMAIL" \
node supabase/seed/seed.mjs
```

The script is idempotent for the bundled synthetic prompt IDs: rerunning it updates the same seed prompts instead of creating duplicates.

It seeds:

- 8 Excel prompts
- 8 Word prompts
- official source labels
- synthetic score/grab metrics for UI testing
- real `.md` objects in the private Storage bucket

To remove the seed:

```bash
SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY" \
SEED_AUTHOR_EMAIL="YOUR_GOOGLE_EMAIL" \
node supabase/seed/seed.mjs --cleanup
```

## 8. Verify Supabase structure

Run:

```text
supabase/verify_setup.sql
```

Expected important results:

- all public tables/view exist
- private `prompt-markdown` bucket exists
- Excel + Word niches exist
- profile trigger exists
- vote/grab RPCs exist
- RLS is enabled on all public cloud tables
- `missing_markdown_objects = 0`
- `orphan_markdown_objects = 0`
- `invalid_okf_paths = 0`

If you ran the bundled seed, `synthetic_prompt_count` should be `16`.

## 9. End-to-end browser check

1. Click the Prompt Grabber `P` logo.
2. Sign in with Google.
3. Confirm Excel and Word niches appear.
4. Search for `pricing`.
5. Open a seeded prompt and confirm the Markdown body loads.
6. Upvote it; click the same upvote again and confirm the vote clears.
7. Downvote and confirm the score changes correctly.
8. Click **Grab** and confirm the prompt appears in local Prompt Grabber history and current selection.
9. Use **Combine** on the grabbed prompt to confirm the text remains unchanged.
10. Share one local prompt to the Prompt Pool and confirm only that prompt appears in cloud storage.
11. Sign out, then sign back in and confirm the pool reloads normally.

## 10. Local code tests

From the extension directory:

```bash
./tests/run-all.sh
```

These are dependency-free Node tests and do not require your Supabase credentials.

## Production hardening checklist

Before Chrome Web Store release:

- replace broad `https://*.supabase.co/*` host permission with your exact project hostname if possible
- verify Google OAuth branding and consent-screen information
- use the final Chrome extension ID in Supabase redirect URLs (replace wildcard with exact ID)
- keep RLS enabled
- never include `service_role` credentials in extension files
- review `PRIVACY.md`
- remove synthetic seed records if they are only for QA/demo

---

## Troubleshooting

### "Authorization page could not be loaded" on a second machine

**Symptom:** Clicking "Continue with Google" shows a Chrome error dialog saying
"Authorization page could not be loaded" or the sign-in popup immediately closes without completing.

**Cause:** Each browser profile that loads the extension unpacked gets a different Extension ID,
producing a different redirect URL (`https://<id>.chromiumapp.org/supabase-auth`).
Supabase rejects any redirect URL that is not in its allowlist.

**Fix (recommended for development):**
1. Open the sign-in page — click the `P` logo in Prompt Grabber.
2. Click **"Copy this machine's redirect URL"** (shown below the sign-in button).
3. Go to **Supabase → Authentication → URL Configuration → Redirect URLs**.
4. Add `https://*.chromiumapp.org/supabase-auth` (wildcard — covers all machines).
5. Click Save, then try signing in again.

**Alternative (machine-specific):** Instead of the wildcard, paste the exact URL copied in step 2.
You will need to repeat this for each new machine.

---

### Sign-in succeeds on one machine but not another (session not shared)

Sessions are stored in `chrome.storage.local` which is per browser profile.
Each device signs in independently — data is then merged via the cloud sync engine on sign-in.
This is expected behaviour; simply sign in on the second machine.

---

### "Google sign-in did not return a Supabase session"

This means the OAuth flow completed but Supabase returned no tokens in the redirect fragment.
Check that:
- The Google provider is enabled in **Supabase → Authentication → Providers → Google**.
- The Google Cloud OAuth client has the Supabase callback URL as an authorized redirect URI:
  `https://<project-ref>.supabase.co/auth/v1/callback`
- The Supabase redirect URL allowlist includes your extension's redirect URL.
