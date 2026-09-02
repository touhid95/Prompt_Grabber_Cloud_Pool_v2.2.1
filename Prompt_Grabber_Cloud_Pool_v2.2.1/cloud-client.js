(function initPromptGrabberCloud(global) {
  "use strict";

  const config = global.PromptGrabberCloudConfig || {};
  const SESSION_KEY = "cloudSession";
  const EXPIRY_SKEW_MS = 60_000;

  function configured() {
    return /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(String(config.supabaseUrl || ""))
      && String(config.publishableKey || "").length > 20
      && !String(config.publishableKey).includes("YOUR_");
  }

  function projectUrl(path = "") {
    return `${String(config.supabaseUrl || "").replace(/\/$/, "")}${path}`;
  }

  function apiKeyHeaders(extra = {}) {
    return {
      apikey: String(config.publishableKey || ""),
      ...extra
    };
  }

  async function readSession() {
    const stored = await chrome.storage.local.get(SESSION_KEY);
    const session = stored?.[SESSION_KEY];
    return session && typeof session === "object" ? session : null;
  }

  async function saveSession(session) {
    await chrome.storage.local.set({ [SESSION_KEY]: session });
    return session;
  }

  async function clearSession() {
    await chrome.storage.local.remove(SESSION_KEY);
  }

  function parseAuthRedirect(url, expectedRedirect = "") {
    const parsed = new URL(url);
    if (expectedRedirect) {
      const expected = new URL(expectedRedirect);
      // For *.chromiumapp.org redirects (Chrome extension OAuth), allow any subdomain
      // because the Extension ID changes per machine when loaded unpacked.
      // For all other origins, enforce an exact origin + pathname match.
      const bothChromiumApp = /\.chromiumapp\.org$/i.test(parsed.hostname)
        && /\.chromiumapp\.org$/i.test(expected.hostname);
      if (bothChromiumApp) {
        // Only check pathname — the subdomains will differ across machines
        if (parsed.pathname !== expected.pathname) {
          throw new Error("Unexpected OAuth redirect URL.");
        }
      } else {
        if (parsed.origin !== expected.origin || parsed.pathname !== expected.pathname) {
          throw new Error("Unexpected OAuth redirect URL.");
        }
      }
    }

    // Implicit Supabase OAuth normally returns session values in the fragment.
    // Read the query as well so provider errors are still surfaced cleanly.
    const params = new URLSearchParams(parsed.hash.replace(/^#/, ""));
    const query = parsed.searchParams;
    const errorDescription = params.get("error_description") || params.get("error")
      || query.get("error_description") || query.get("error");
    if (errorDescription) throw new Error(errorDescription);

    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const expiresAtSeconds = Number(params.get("expires_at") || 0);
    const expiresIn = Number(params.get("expires_in") || 3600);
    if (!accessToken || !refreshToken) throw new Error("Google sign-in did not return a Supabase session.");

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: params.get("token_type") || "bearer",
      expires_at: expiresAtSeconds > 0
        ? expiresAtSeconds * 1000
        : Date.now() + Math.max(60, expiresIn) * 1000
    };
  }

  async function signInWithGoogle() {
    if (!configured()) throw new Error("Cloud Prompt Pool is not configured yet.");
    if (!chrome.identity?.launchWebAuthFlow) throw new Error("Chrome identity API is unavailable.");

    const redirectTo = chrome.identity.getRedirectURL("supabase-auth");
    const authUrl = new URL(projectUrl("/auth/v1/authorize"));
    authUrl.searchParams.set("provider", "google");
    authUrl.searchParams.set("redirect_to", redirectTo);

    let finalUrl;
    try {
      finalUrl = await chrome.identity.launchWebAuthFlow({
        url: authUrl.toString(),
        interactive: true
      });
    } catch (err) {
      // Chrome throws "Authorization page could not be loaded" / "ERR_ABORTED" when
      // Supabase rejects the redirect URL — this happens on machines whose Extension ID
      // is not yet in the Supabase "Redirect URLs" allowlist.
      const msg = String(err?.message || err || "");
      const isRedirectBlocked = /ERR_ABORTED|could not be loaded|not loaded|aborted/i.test(msg);
      if (isRedirectBlocked) {
        throw new Error(
          `Sign-in blocked: Supabase has not allowed this machine's redirect URL.\n` +
          `Add the following URL to Supabase → Authentication → URL Configuration → Redirect URLs:\n\n` +
          `${redirectTo}\n\n` +
          `Or add the wildcard: https://*.chromiumapp.org/supabase-auth`
        );
      }
      throw err;
    }

    if (!finalUrl) throw new Error("Google sign-in was cancelled.");

    const session = parseAuthRedirect(finalUrl, redirectTo);
    const user = await fetchUser(session.access_token);
    session.user = user;
    await saveSession(session);
    return session;
  }

  async function fetchUser(accessToken) {
    const response = await fetch(projectUrl("/auth/v1/user"), {
      headers: apiKeyHeaders({ Authorization: `Bearer ${accessToken}` })
    });
    if (!response.ok) throw new Error(await responseMessage(response, "Unable to load the signed-in user."));
    return response.json();
  }

  async function refreshSession(session) {
    if (!session?.refresh_token) return null;
    const response = await fetch(projectUrl("/auth/v1/token?grant_type=refresh_token"), {
      method: "POST",
      headers: apiKeyHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    if (!response.ok) {
      await clearSession();
      return null;
    }
    const data = await response.json();
    const refreshed = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || session.refresh_token,
      token_type: data.token_type || "bearer",
      expires_at: Date.now() + Math.max(60, Number(data.expires_in || 3600)) * 1000,
      user: data.user || session.user || null
    };
    if (!refreshed.user) refreshed.user = await fetchUser(refreshed.access_token);
    return saveSession(refreshed);
  }

  async function session() {
    let current = await readSession();
    if (!current?.access_token) return null;
    if (!Number.isFinite(Number(current.expires_at)) || Number(current.expires_at) <= Date.now() + EXPIRY_SKEW_MS) {
      current = await refreshSession(current);
    }
    return current;
  }

  async function requireSession() {
    const current = await session();
    if (!current?.access_token) throw new Error("Sign in with Google to use the Prompt Pool.");
    return current;
  }

  async function signOut() {
    const current = await readSession();
    if (current?.access_token && configured()) {
      try {
        await fetch(projectUrl("/auth/v1/logout"), {
          method: "POST",
          headers: apiKeyHeaders({ Authorization: `Bearer ${current.access_token}` })
        });
      } catch (_error) { /* local sign-out still continues */ }
    }
    await clearSession();
  }

  async function withAuthorizedFetch(buildRequest) {
    let current = await requireSession();
    let response = await buildRequest(current);
    if (response.status !== 401) return response;

    // A token can be invalidated before its locally stored expiry. Refresh once,
    // then retry the exact cloud operation so normal use does not unexpectedly stop.
    current = await refreshSession(await readSession());
    if (!current?.access_token) return response;
    response = await buildRequest(current);
    return response;
  }

  async function rest(resource, { method = "GET", query = {}, body, prefer = "" } = {}) {
    const url = new URL(projectUrl(`/rest/v1/${resource}`));
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    });

    const response = await withAuthorizedFetch(async (current) => {
      const headers = apiKeyHeaders({
        Authorization: `Bearer ${current.access_token}`,
        "Content-Type": "application/json"
      });
      if (prefer) headers.Prefer = prefer;
      return fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    });

    if (!response.ok) throw new Error(await responseMessage(response, `Cloud request failed (${response.status}).`));
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async function rpc(functionName, args = {}) {
    return rest(`rpc/${functionName}`, {
      method: "POST",
      body: args,
      prefer: "return=representation"
    });
  }

  function encodeObjectPath(path) {
    return String(path || "").split("/").map(encodeURIComponent).join("/");
  }

  async function uploadMarkdown(path, markdown, { upsert = false } = {}) {
    const bucket = encodeURIComponent(config.markdownBucket || "prompt-markdown");
    const response = await withAuthorizedFetch((current) => fetch(projectUrl(`/storage/v1/object/${bucket}/${encodeObjectPath(path)}`), {
      method: "POST",
      headers: apiKeyHeaders({
        Authorization: `Bearer ${current.access_token}`,
        "Content-Type": "text/markdown",
        "x-upsert": upsert ? "true" : "false"
      }),
      body: String(markdown || "")
    }));
    if (!response.ok) throw new Error(await responseMessage(response, "Unable to upload prompt Markdown."));
    return response.json().catch(() => ({ path }));
  }

  async function downloadMarkdown(path) {
    const bucket = encodeURIComponent(config.markdownBucket || "prompt-markdown");
    const response = await withAuthorizedFetch((current) => fetch(projectUrl(`/storage/v1/object/authenticated/${bucket}/${encodeObjectPath(path)}`), {
      headers: apiKeyHeaders({ Authorization: `Bearer ${current.access_token}` })
    }));
    if (!response.ok) throw new Error(await responseMessage(response, "Unable to download prompt Markdown."));
    return response.text();
  }

  async function deleteMarkdown(path) {
    const bucket = String(config.markdownBucket || "prompt-markdown");
    const response = await withAuthorizedFetch((current) => fetch(projectUrl(`/storage/v1/object/${encodeURIComponent(bucket)}`), {
      method: "DELETE",
      headers: apiKeyHeaders({
        Authorization: `Bearer ${current.access_token}`,
        "Content-Type": "application/json"
      }),
      body: JSON.stringify({ prefixes: [String(path || "")] })
    }));
    return response.ok;
  }

  async function fetchNotes() {
    const data = await rest("user_notes", { query: { select: "*", order: "updated_at.desc" } });
    return Array.isArray(data) ? data : [];
  }

  async function fetchPrompts() {
    const data = await rest("user_prompts", { query: { select: "*", order: "created_at.desc", limit: "100" } });
    return Array.isArray(data) ? data : [];
  }

  async function pushNotes(items) {
    if (!items.length) return;
    return rpc("sync_notes", { items });
  }

  async function pushPrompts(items) {
    if (!items.length) return;
    return rpc("sync_prompts", { items });
  }

  async function fetchRules() {
    const data = await rest("user_rules", { query: { select: "*", order: "updated_at.desc" } });
    return Array.isArray(data) ? data : [];
  }

  async function pushRules(items) {
    if (!items.length) return;
    return rpc("sync_rules", { items });
  }

  async function healthCheck() {
    if (!configured()) return { ok: false, configured: false, authenticated: false, message: "Cloud configuration is missing." };
    const current = await session();
    if (!current) return { ok: true, configured: true, authenticated: false, message: "Cloud configured. Sign in to continue." };
    try {
      await rest("niches", { query: { select: "id", limit: 1 } });
      return { ok: true, configured: true, authenticated: true, message: "Cloud connection is ready." };
    } catch (error) {
      return { ok: false, configured: true, authenticated: true, message: error?.message || "Cloud check failed." };
    }
  }

  async function responseMessage(response, fallback) {
    try {
      const clone = response.clone();
      const data = await clone.json();
      return data?.msg || data?.message || data?.error_description || data?.error || fallback;
    } catch (_error) {
      try { return (await response.text()) || fallback; } catch (_nested) { return fallback; }
    }
  }

  global.PromptGrabberCloud = Object.freeze({
    configured,
    config,
    session,
    requireSession,
    signInWithGoogle,
    signOut,
    rest,
    rpc,
    uploadMarkdown,
    downloadMarkdown,
    deleteMarkdown,
    fetchNotes,
    fetchPrompts,
    pushNotes,
    pushPrompts,
    fetchRules,
    pushRules,
    healthCheck,
    parseAuthRedirect,
    redirectUrl() { return chrome.identity?.getRedirectURL?.("supabase-auth") || ""; }
  });
})(globalThis);
