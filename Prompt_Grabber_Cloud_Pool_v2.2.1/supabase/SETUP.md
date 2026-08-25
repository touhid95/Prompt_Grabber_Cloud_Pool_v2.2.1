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

Get the exact URL by loading the extension and using the Prompt Pool setup screen's **Copy OAuth redirect** action, or from an extension console:

```js
chrome.identity.getRedirectURL("supabase-auth")
```

Add the exact result to:

**Supabase → Authentication → URL Configuration → Redirect URLs**

For a Chrome Web Store release, verify this again using the final stable extension ID.

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
- use the final Chrome extension ID in Supabase redirect URLs
- keep RLS enabled
- never include `service_role` credentials in extension files
- review `PRIVACY.md`
- remove synthetic seed records if they are only for QA/demo
