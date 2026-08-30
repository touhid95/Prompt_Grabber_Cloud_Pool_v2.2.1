/**
 * sync.js — Cross-device sync engine for Prompt Grabber
 *
 * Pulls notes and captured prompts from Supabase on sign-in,
 * merges with local data (newest updatedAt wins), and pushes
 * every local change back to the cloud in real time.
 *
 * Depends on: cloud-config.js, cloud-client.js
 * Exposed as: globalThis.PromptGrabberSync
 */
(function initPromptGrabberSync(global) {
  "use strict";

  const Cloud = global.PromptGrabberCloud;
  const CLOUD_PROMPT_LIMIT = 100;

  let _status = "not-signed-in";
  let _onStatusChange = null;
  // Debounce timer for note input events
  let _noteDebounceTimer = null;
  const NOTE_DEBOUNCE_MS = 1500;

  // ── Status ───────────────────────────────────────────────────────────────────

  function setStatus(status) {
    _status = status;
    try { _onStatusChange?.(status); } catch (_e) { /* ignore */ }
  }

  // ── Merge helpers ─────────────────────────────────────────────────────────────

  /**
   * Union of local + cloud notes. Cloud row wins when its updated_at >= local updatedAt.
   * Soft-deleted rows (deleted_at set) are stripped from the result.
   */
  function mergeNotes(local, cloud) {
    const map = new Map();
    for (const note of local) map.set(note.id, note);
    for (const row of cloud) {
      const loc = map.get(row.id);
      const cloudTs = Date.parse(row.updated_at || "");
      const localTs = Date.parse(loc?.updatedAt || "");
      if (!loc || cloudTs >= localTs) {
        map.set(row.id, {
          id: row.id,
          title: row.title ?? "",
          body: row.body ?? "",
          createdAt: row.created_at ?? new Date().toISOString(),
          updatedAt: row.updated_at ?? new Date().toISOString(),
          _del: row.deleted_at ?? null
        });
      }
    }
    return [...map.values()]
      .filter(n => !n._del)
      .map(({ _del, ...note }) => note);
  }

  /**
   * Union of local + cloud captured prompts. Cloud row wins when its updated_at >= local editedAt/createdAt.
   * Soft-deleted rows stripped. Result capped at CLOUD_PROMPT_LIMIT, newest first.
   */
  function mergePrompts(local, cloud) {
    const map = new Map();
    for (const p of local) map.set(p.id, p);
    for (const row of cloud) {
      const loc = map.get(row.id);
      const cloudTs = Date.parse(row.updated_at || row.created_at || "");
      const localTs = Date.parse(loc?.editedAt || loc?.createdAt || "");
      if (!loc || cloudTs >= localTs) {
        const entry = {
          id: row.id,
          text: row.text ?? "",
          siteId: row.site_id ?? "",
          siteName: row.site_name ?? "",
          url: row.url ?? "",
          pageTitle: row.page_title ?? "",
          captureMethod: row.capture_method ?? "",
          createdAt: row.created_at ?? new Date().toISOString(),
          _del: row.deleted_at ?? null
        };
        if (row.updated_at && row.updated_at !== row.created_at) {
          entry.editedAt = row.updated_at;
        }
        map.set(row.id, entry);
      }
    }
    return [...map.values()]
      .filter(p => !p._del)
      .map(({ _del, ...p }) => p)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, CLOUD_PROMPT_LIMIT);
  }

  // ── Core sync ─────────────────────────────────────────────────────────────────

  /**
   * Full sync: fetch cloud data, merge with local, save merged result locally,
   * then push the merged set back to cloud so all devices converge.
   * Call this on manager page load when a session exists.
   */
  async function start() {
    if (!Cloud?.configured()) { setStatus("not-signed-in"); return; }
    const sess = await Cloud.session().catch(() => null);
    if (!sess) { setStatus("not-signed-in"); return; }

    setStatus("syncing");
    try {
      const [cloudNotes, cloudPrompts, stored] = await Promise.all([
        Cloud.fetchNotes().catch(() => []),
        Cloud.fetchPrompts().catch(() => []),
        chrome.storage.local.get(["notes", "prompts"])
      ]);

      const localNotes = Array.isArray(stored.notes) ? stored.notes : [];
      const localPrompts = Array.isArray(stored.prompts) ? stored.prompts : [];

      const mergedNotes = mergeNotes(localNotes, cloudNotes);
      const mergedPrompts = mergePrompts(localPrompts, cloudPrompts);

      // Persist merged data locally (storage change triggers manager re-render)
      await chrome.storage.local.set({ notes: mergedNotes, prompts: mergedPrompts });

      // Push merged data back so cloud is up to date too
      await Promise.all([
        Cloud.pushNotes(mergedNotes).catch(() => {}),
        Cloud.pushPrompts(mergedPrompts).catch(() => {})
      ]);

      setStatus("synced");
    } catch (_error) {
      setStatus("offline");
    }
  }

  // ── Incremental push helpers ──────────────────────────────────────────────────

  async function _withSession(fn) {
    if (!Cloud?.configured()) return;
    const sess = await Cloud.session().catch(() => null);
    if (!sess) return;
    return fn();
  }

  /**
   * Push a single note to cloud. Debounced — multiple rapid edits to the same
   * note only trigger one network call after the user pauses typing.
   */
  function pushNote(note) {
    clearTimeout(_noteDebounceTimer);
    _noteDebounceTimer = setTimeout(async () => {
      setStatus("syncing");
      try {
        await _withSession(() => Cloud.pushNotes([note]));
        setStatus("synced");
      } catch (_e) {
        setStatus("offline");
      }
    }, NOTE_DEBOUNCE_MS);
  }

  /**
   * Soft-delete a note in cloud by setting deletedAt, then push.
   */
  async function deleteNote(noteId) {
    setStatus("syncing");
    try {
      await _withSession(() => Cloud.pushNotes([{
        id: noteId,
        title: "", body: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: new Date().toISOString()
      }]));
      setStatus("synced");
    } catch (_e) {
      setStatus("offline");
    }
  }

  /**
   * Push a single edited/deleted prompt to cloud.
   */
  async function pushPrompt(prompt) {
    setStatus("syncing");
    try {
      await _withSession(() => Cloud.pushPrompts([prompt]));
      setStatus("synced");
    } catch (_e) {
      setStatus("offline");
    }
  }

  /**
   * Push a batch of newly-captured prompts (called from background.js).
   * Fails silently — background capture should not be interrupted by sync errors.
   */
  async function pushPromptBatch(newPrompts) {
    try {
      await _withSession(() => Cloud.pushPrompts(newPrompts));
    } catch (_e) { /* silent */ }
  }

  /**
   * Soft-delete all cloud prompts for the current user (called on Clear All).
   */
  async function clearPrompts() {
    try {
      await _withSession(async () => {
        const cloudPrompts = await Cloud.fetchPrompts().catch(() => []);
        if (!cloudPrompts.length) return;
        const now = new Date().toISOString();
        const tombstones = cloudPrompts.map(row => ({
          id: row.id,
          text: row.text || "",
          siteId: row.site_id || "",
          siteName: row.site_name || "",
          url: row.url || "",
          pageTitle: row.page_title || "",
          captureMethod: row.capture_method || "",
          createdAt: row.created_at || now,
          updatedAt: now,
          deletedAt: now
        }));
        await Cloud.pushPrompts(tombstones);
      });
    } catch (_e) { /* silent */ }
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  global.PromptGrabberSync = Object.freeze({
    /** Start a full sync. Call on page load when session is available. */
    start,
    /** Push a single note after any edit (debounced). */
    pushNote,
    /** Soft-delete a note in cloud. */
    deleteNote,
    /** Push an edited/deleted captured prompt. */
    pushPrompt,
    /** Push a batch of newly captured prompts (background use). */
    pushPromptBatch,
    /** Soft-delete all cloud prompts (Clear All). */
    clearPrompts,
    /** Current sync status string. */
    get status() { return _status; },
    /** Register a callback for status changes: fn(status: string) */
    onStatusChange(cb) { _onStatusChange = typeof cb === "function" ? cb : null; }
  });
})(globalThis);
