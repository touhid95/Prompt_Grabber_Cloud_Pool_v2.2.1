"use strict";

importScripts("capture-core.js", "cloud-config.js", "cloud-client.js", "sync.js");

const Core = globalThis.PromptGrabberCore;
const CUSTOM_SCRIPT_ID = "prompt-grabber-custom-sites";
const MAX_STORED_CHARACTERS = 4_000_000;
let writeQueue = Promise.resolve();

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(["settings", "prompts", "rules", "combineSelection"]);
  const settings = Core.mergeSettings(current.settings);
  await chrome.storage.local.set({
    settings,
    prompts: Array.isArray(current.prompts) ? current.prompts : [],
    rules: Core.normalizeRules(current.rules),
    combineSelection: Array.isArray(current.combineSelection) ? current.combineSelection : []
  });
  await chrome.storage.local.remove("promptOutput");
  await ensureCustomSiteScripts();
  await refreshBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.storage.local.remove("promptOutput");
  await ensureCustomSiteScripts();
  await refreshBadge();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.settings) ensureCustomSiteScripts().catch(() => undefined);
  if (changes.prompts) refreshBadge(changes.prompts.newValue).catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "CAPTURE_PROMPT") {
    writeQueue = writeQueue.then(() => savePrompt(message.payload, sender));
    writeQueue.then(sendResponse).catch((error) => sendResponse({ saved: false, error: error.message }));
    return true;
  }

  if (message?.type === "CAPTURE_PROMPT_BATCH") {
    writeQueue = writeQueue.then(() => savePromptBatch(message.payload, sender));
    writeQueue.then(sendResponse).catch((error) => sendResponse({ ok: false, saved: 0, error: error.message }));
    return true;
  }

  if (message?.type === "REFRESH_CUSTOM_SITES") {
    ensureCustomSiteScripts().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }

  return false;
});

async function savePrompt(payload, sender) {
  const current = await chrome.storage.local.get(["settings", "prompts"]);
  const settings = Core.mergeSettings(current.settings);
  if (!settings.enabled) return { saved: false, reason: "disabled" };

  const text = Core.cleanPromptText(payload?.text);
  if (!text || text.length > 100000) return { saved: false, reason: "invalid-text" };

  const senderUrl = sender?.tab?.url || payload?.url || "";
  let parsed;
  try { parsed = new URL(senderUrl); } catch (_error) { return { saved: false, reason: "invalid-url" }; }

  const detected = Core.detectSite(parsed.hostname, parsed.pathname);
  const customAllowed = settings.customOrigins.includes(parsed.origin);
  if (!detected && !customAllowed) return { saved: false, reason: "unsupported-site" };

  const siteId = detected?.id || `custom:${parsed.hostname}`;
  const siteName = detected?.name || payload?.siteName || parsed.hostname;
  if (settings.blockedSites.includes(siteId) || settings.blockedSites.includes(parsed.origin)) {
    return { saved: false, reason: "site-disabled" };
  }

  const prompts = Array.isArray(current.prompts) ? current.prompts : [];
  const newest = prompts[0];
  const now = new Date();
  const newestCapturedText = newest ? String(newest.originalText || newest.text || "") : "";
  if (newest && newestCapturedText === text && newest.siteId === siteId && now.getTime() - Date.parse(newest.createdAt) < 10000) {
    return { saved: false, reason: "duplicate", id: newest.id };
  }

  const record = {
    id: crypto.randomUUID(),
    text,
    siteId,
    siteName,
    url: Core.stripUrl(senderUrl, settings.captureUrl),
    pageTitle: String(sender?.tab?.title || payload?.pageTitle || "").trim().slice(0, 300),
    captureMethod: String(payload?.reason || "automatic"),
    createdAt: now.toISOString()
  };

  prompts.unshift(record);
  trimPromptHistory(prompts, settings.maxPrompts);
  await chrome.storage.local.set({ prompts });
  globalThis.PromptGrabberSync?.pushPromptBatch([record]);
  return { saved: true, id: record.id };
}


async function savePromptBatch(payload, sender) {
  const current = await chrome.storage.local.get(["settings", "prompts"]);
  const settings = Core.mergeSettings(current.settings);
  if (!settings.enabled) return { ok: false, saved: 0, skipped: 0, reason: "disabled" };

  const rawTexts = Array.isArray(payload?.prompts) ? payload.prompts.slice(0, 1000) : [];
  const texts = rawTexts
    .map((value) => Core.cleanPromptText(typeof value === "string" ? value : value?.text))
    .filter((text) => text && text.length <= 100000);
  if (!texts.length) return { ok: false, saved: 0, skipped: 0, reason: "invalid-text" };

  const senderUrl = sender?.tab?.url || payload?.url || "";
  let parsed;
  try { parsed = new URL(senderUrl); } catch (_error) { return { ok: false, saved: 0, skipped: texts.length, reason: "invalid-url" }; }

  const detected = Core.detectSite(parsed.hostname, parsed.pathname);
  const customAllowed = settings.customOrigins.includes(parsed.origin);
  if (!detected && !customAllowed) return { ok: false, saved: 0, skipped: texts.length, reason: "unsupported-site" };

  const siteId = detected?.id || `custom:${parsed.hostname}`;
  const siteName = detected?.name || payload?.siteName || parsed.hostname;
  if (settings.blockedSites.includes(siteId) || settings.blockedSites.includes(parsed.origin)) {
    return { ok: false, saved: 0, skipped: texts.length, reason: "site-disabled" };
  }

  const prompts = Array.isArray(current.prompts) ? current.prompts : [];
  const pageTitle = String(sender?.tab?.title || payload?.pageTitle || "").trim().slice(0, 300);
  const storedUrl = Core.stripUrl(senderUrl, settings.captureUrl);
  const sourceKey = storedUrl || pageTitle;

  // Frequency-aware duplicate handling matters because a real conversation can
  // contain the exact same user prompt multiple times (for example “continue”).
  const existingCounts = new Map();
  for (const prompt of prompts) {
    if (prompt?.siteId !== siteId) continue;
    const promptSourceKey = String(prompt?.url || prompt?.pageTitle || "");
    if (sourceKey && promptSourceKey && promptSourceKey !== sourceKey) continue;
    const capturedText = String(prompt?.originalText || prompt?.text || "");
    const key = `${siteId}\u0000${capturedText}`;
    existingCounts.set(key, (existingCounts.get(key) || 0) + 1);
  }

  const seenInScan = new Map();
  const records = [];
  const baseTime = Date.now();

  texts.forEach((text, index) => {
    const key = `${siteId}\u0000${text}`;
    const occurrence = (seenInScan.get(key) || 0) + 1;
    seenInScan.set(key, occurrence);
    if (occurrence <= (existingCounts.get(key) || 0)) return;

    records.push({
      id: crypto.randomUUID(),
      text,
      siteId,
      siteName,
      url: storedUrl,
      pageTitle,
      captureMethod: String(payload?.reason || "chat-scan"),
      // DOM order is oldest → newest. Give newer messages later timestamps so
      // manager sorting and popup ordering agree.
      createdAt: new Date(baseTime - (texts.length - 1 - index)).toISOString()
    });
  });

  if (records.length) {
    prompts.unshift(...records.slice().reverse());
    trimPromptHistory(prompts, settings.maxPrompts);
    await chrome.storage.local.set({ prompts });
    globalThis.PromptGrabberSync?.pushPromptBatch(records);
  }

  return {
    ok: true,
    found: texts.length,
    saved: records.length,
    skipped: texts.length - records.length
  };
}

function trimPromptHistory(prompts, maximum) {
  if (prompts.length > maximum) prompts.length = maximum;
  let characters = 0;
  for (let index = 0; index < prompts.length; index += 1) {
    characters += prompts[index]?.text?.length || 0;
    if (characters > MAX_STORED_CHARACTERS) {
      prompts.length = Math.max(index, 1);
      break;
    }
  }
}

async function ensureCustomSiteScripts() {
  const { settings: storedSettings } = await chrome.storage.local.get("settings");
  const settings = Core.mergeSettings(storedSettings);
  const matches = [];

  for (const origin of settings.customOrigins) {
    const pattern = Core.originToMatchPattern(origin);
    if (!pattern) continue;
    const granted = await chrome.permissions.contains({ origins: [pattern] });
    if (granted) matches.push(pattern);
  }

  try { await chrome.scripting.unregisterContentScripts({ ids: [CUSTOM_SCRIPT_ID] }); } catch (_error) { /* Not registered yet. */ }
  if (!matches.length) return;

  await chrome.scripting.registerContentScripts([{
    id: CUSTOM_SCRIPT_ID,
    matches,
    js: ["capture-core.js", "content.js"],
    css: ["content.css"],
    runAt: "document_start",
    allFrames: false,
    persistAcrossSessions: true
  }]);
}

async function refreshBadge(knownPrompts) {
  const prompts = Array.isArray(knownPrompts)
    ? knownPrompts
    : (await chrome.storage.local.get("prompts")).prompts || [];
  const count = prompts.length;
  await chrome.action.setBadgeBackgroundColor({ color: "#2563EB" });
  await chrome.action.setBadgeText({ text: count ? (count > 999 ? "999+" : String(count)) : "" });
}
