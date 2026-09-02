"use strict";

const Core = globalThis.PromptGrabberCore;
const AI = globalThis.PromptGrabberAI;
const elements = {
  openPromptPoolButton: document.querySelector("#openPromptPoolButton"), globalToggle: document.querySelector("#globalToggle"), statusText: document.querySelector("#statusText"), sitePanel: document.querySelector("#sitePanel"),
  siteDot: document.querySelector("#siteDot"), siteName: document.querySelector("#siteName"), siteMessage: document.querySelector("#siteMessage"),
  enableSiteButton: document.querySelector("#enableSiteButton"), totalCount: document.querySelector("#totalCount"), openManagerButton: document.querySelector("#openManagerButton"),
  captureNowButton: document.querySelector("#captureNowButton"), promptDateFilter: document.querySelector("#promptDateFilter"), settingsButton: document.querySelector("#settingsButton"), ruleBookButton: document.querySelector("#ruleBookButton"),
  emptyState: document.querySelector("#emptyState"), promptList: document.querySelector("#promptList"), combinePanel: document.querySelector("#combinePanel"),
  combineCount: document.querySelector("#combineCount"), combineRuleCount: document.querySelector("#combineRuleCount"), copyCombinedButton: document.querySelector("#copyCombinedButton"),
  compileCombinedButton: document.querySelector("#compileCombinedButton"), clearCombineButton: document.querySelector("#clearCombineButton"),
  notesStatus: document.querySelector("#notesStatus"), addNoteButton: document.querySelector("#addNoteButton"),
  notesEmpty: document.querySelector("#notesEmpty"), notesList: document.querySelector("#notesList"),
  ruleToggleMenu: document.querySelector("#ruleToggleMenu"),
  ruleToggleList: document.querySelector("#ruleToggleList"),
  resultDialog: document.querySelector("#resultDialog"), resultMode: document.querySelector("#resultMode"), resultTitle: document.querySelector("#resultTitle"),
  resultMeta: document.querySelector("#resultMeta"), resultText: document.querySelector("#resultText"), closeResultButton: document.querySelector("#closeResultButton"),
  copyResultButton: document.querySelector("#copyResultButton")
};

let settings = Core.mergeSettings();
let prompts = [];
let rules = [];
let combineSelection = [];
let combineNoteSelection = [];
let activeTab = null;
let currentSite = null;
let editingPromptId = null;
let notes = [];
let noteSaveVersion = 0;

initialize().catch(() => { elements.statusText.textContent = "Unable to access this page"; });

async function initialize() {
  const [stored, tabs] = await Promise.all([
    chrome.storage.local.get(["settings", "prompts", "rules", "combineSelection", "combineNoteSelection", "notes", "quickNote"]),
    chrome.tabs.query({ active: true, currentWindow: true })
  ]);
  settings = Core.mergeSettings(stored.settings);
  prompts = Array.isArray(stored.prompts) ? stored.prompts : [];
  rules = Core.normalizeRules(stored.rules);
  combineSelection = normalizeSelection(stored.combineSelection);
  combineNoteSelection = normalizeNoteSelection(stored.combineNoteSelection);
  notes = normalizeNotes(stored.notes, stored.quickNote);
  activeTab = tabs[0] || null;
  elements.globalToggle.checked = settings.enabled;
  renderPrompts();
  renderCombinePanel();
  renderNotes();
  await migrateLocalNoteStorage(stored);
  await renderCurrentSite();
  bindEvents();
}

function bindEvents() {
  elements.openPromptPoolButton.addEventListener("click", openPromptPool);
  elements.globalToggle.addEventListener("change", async () => {
    settings.enabled = elements.globalToggle.checked;
    await saveSettings();
    await renderCurrentSite();
  });
  elements.openManagerButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
  elements.settingsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
  elements.ruleBookButton.addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("manager.html#rules") }));

  // Rule toggle menu
  elements.combineRuleCount.addEventListener("click", (e) => {
    e.stopPropagation();
    const isHidden = elements.ruleToggleMenu.hidden;
    elements.ruleToggleMenu.hidden = !isHidden;
    elements.combineRuleCount.setAttribute("aria-expanded", !isHidden);
    if (isHidden) renderRuleToggleMenu();
  });

  // Close menu when clicking outside
  document.addEventListener("click", (e) => {
    if (!elements.ruleToggleMenu.hidden && !elements.ruleToggleMenu.contains(e.target) && !elements.combineRuleCount.contains(e.target)) {
      elements.ruleToggleMenu.hidden = true;
      elements.combineRuleCount.setAttribute("aria-expanded", "false");
    }
  });

  elements.enableSiteButton.addEventListener("click", enableCurrentSite);
  elements.captureNowButton.addEventListener("click", captureCurrentChat);
  elements.promptDateFilter.addEventListener("change", renderPrompts);
  elements.promptList.addEventListener("click", handlePromptAction);
  elements.copyCombinedButton.addEventListener("click", createCombinedOutput);
  elements.compileCombinedButton.addEventListener("click", compileSelection);
  elements.clearCombineButton.addEventListener("click", clearCombineSelection);
  elements.closeResultButton.addEventListener("click", closeResultDialog);
  elements.copyResultButton.addEventListener("click", copyResultText);
  elements.addNoteButton.addEventListener("click", addNote);
  elements.notesList.addEventListener("input", handleNoteInput);
  elements.notesList.addEventListener("click", handleNoteAction);
  chrome.storage.onChanged.addListener(handleStorageChange);
}

function handleStorageChange(changes, areaName) {
  if (areaName !== "local") return;
  if (changes.prompts) {
    prompts = Array.isArray(changes.prompts.newValue) ? changes.prompts.newValue : [];
    combineSelection = normalizeSelection(combineSelection);
    renderPrompts();
    renderCombinePanel();
  }
  if (changes.rules) {
    rules = Core.normalizeRules(changes.rules.newValue);
    renderCombinePanel();
  }
  if (changes.combineSelection) {
    combineSelection = normalizeSelection(changes.combineSelection.newValue);
    renderPrompts();
    renderCombinePanel();
  }
  if (changes.combineNoteSelection) {
    combineNoteSelection = normalizeNoteSelection(changes.combineNoteSelection.newValue);
    renderNotes();
    renderCombinePanel();
  }
  if (changes.notes) {
    notes = normalizeNotes(changes.notes.newValue);
    const editingNote = document.activeElement?.closest?.("[data-note-id]");
    if (!editingNote) renderNotes();
  }
}

async function renderCurrentSite() {
  if (!activeTab?.url) {
    elements.statusText.textContent = settings.enabled ? "Automatic capture is on" : "Automatic capture is off";
    return;
  }

  let url;
  try { url = new URL(activeTab.url); } catch (_error) { return; }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    elements.statusText.textContent = "Not available on this browser page";
    elements.captureNowButton.hidden = true;
    return;
  }

  const builtIn = Core.detectSite(url.hostname, url.pathname);
  const custom = settings.customOrigins.includes(url.origin);
  currentSite = builtIn || (custom ? { id: `custom:${url.hostname}`, name: readableName(url.hostname) } : null);
  elements.sitePanel.hidden = false;
  elements.siteName.textContent = currentSite?.name || readableName(url.hostname);
  elements.siteDot.className = "status-dot";
  elements.enableSiteButton.hidden = true;

  if (!currentSite) {
    elements.statusText.textContent = "This site is not enabled";
    elements.siteMessage.textContent = "Enable it once for automatic capture";
    elements.siteDot.classList.add("status-dot--warning");
    elements.enableSiteButton.hidden = false;
    elements.captureNowButton.hidden = true;
    return;
  }

  const blocked = settings.blockedSites.includes(currentSite.id) || settings.blockedSites.includes(url.origin);
  const active = settings.enabled && !blocked;
  elements.statusText.textContent = active ? `Active on ${currentSite.name}` : "Automatic capture is paused";
  elements.siteMessage.textContent = active ? "Prompts are saved when sent" : "Turn capture on above";
  if (active) elements.siteDot.classList.add("status-dot--active");
  elements.captureNowButton.hidden = !active;
}

async function enableCurrentSite() {
  if (!activeTab?.url) return;
  const url = new URL(activeTab.url);
  const pattern = Core.originToMatchPattern(url.origin);
  elements.enableSiteButton.disabled = true;
  elements.enableSiteButton.textContent = "Enabling…";

  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) {
    elements.enableSiteButton.disabled = false;
    elements.enableSiteButton.textContent = "Enable site";
    elements.siteMessage.textContent = "Site access was not granted";
    return;
  }

  settings.customOrigins = [...new Set([...settings.customOrigins, url.origin])];
  await saveSettings();
  await chrome.runtime.sendMessage({ type: "REFRESH_CUSTOM_SITES" });
  try {
    await chrome.scripting.insertCSS({ target: { tabId: activeTab.id }, files: ["content.css"] });
    await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ["capture-core.js", "content.js"] });
  } catch (_error) { /* Initializes on next page load. */ }
  await renderCurrentSite();
}

async function captureCurrentChat() {
  if (!activeTab?.id) return;
  elements.captureNowButton.disabled = true;
  elements.captureNowButton.textContent = "Grabbing…";
  try {
    const result = await chrome.tabs.sendMessage(activeTab.id, { type: "CAPTURE_CHAT_PROMPTS" });
    const stored = await chrome.storage.local.get("prompts");
    prompts = Array.isArray(stored.prompts) ? stored.prompts : prompts;
    combineSelection = normalizeSelection(combineSelection);
    renderPrompts();
    renderCombinePanel();

    const found = Number(result?.found || 0);
    const saved = Number(result?.saved || 0);
    if (!found) elements.captureNowButton.textContent = "No prompts";
    else if (saved) elements.captureNowButton.textContent = `Grabbed ${saved}`;
    else elements.captureNowButton.textContent = "All saved";
  } catch (_error) {
    elements.captureNowButton.textContent = "Reload page";
  } finally {
    setTimeout(() => {
      elements.captureNowButton.disabled = false;
      elements.captureNowButton.textContent = "Grab now";
    }, 1200);
  }
}

function renderPrompts() {
  elements.totalCount.textContent = prompts.length.toLocaleString();
  const recent = filterPromptsByDate(prompts, elements.promptDateFilter?.value || "all").slice(0, 8);
  elements.emptyState.hidden = recent.length > 0;
  if (!recent.length && prompts.length) {
    const label = elements.promptDateFilter?.selectedOptions?.[0]?.textContent || "selected date";
    elements.emptyState.querySelector("strong").textContent = "No prompts in this period";
    elements.emptyState.querySelector("p").textContent = `Try another date filter. Current: ${label}.`;
  } else {
    elements.emptyState.querySelector("strong").textContent = "No prompts yet";
    elements.emptyState.querySelector("p").textContent = "Submitted prompts will appear here.";
  }
  elements.promptList.replaceChildren(...recent.map(createPromptCard));
}

function filterPromptsByDate(items, dateFilter) {
  if (dateFilter === "all") return items;
  const now = Date.now();
  const todayStart = startOfToday();
  const cutoffs = { today: todayStart, week: now - 7 * 86400000, month: now - 30 * 86400000 };

  return items.filter((prompt) => {
    const createdAt = Date.parse(prompt.createdAt);
    if (!Number.isFinite(createdAt)) return false;
    if (dateFilter === "yesterday") {
      const yesterdayStart = todayStart - 86400000;
      return createdAt >= yesterdayStart && createdAt < todayStart;
    }
    return createdAt >= cutoffs[dateFilter];
  });
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function createPromptCard(prompt) {
  const selected = combineSelection.includes(prompt.id);
  const editing = editingPromptId === prompt.id;
  const card = document.createElement("article");
  card.className = `prompt-card${selected ? " is-selected" : ""}${editing ? " is-editing" : ""}`;
  card.dataset.id = prompt.id;

  const meta = document.createElement("div");
  meta.className = "prompt-card__meta";
  const site = document.createElement("span");
  site.className = "prompt-card__site";
  site.textContent = prompt.siteName || "AI site";
  const time = document.createElement("span");
  time.textContent = formatRelativeTime(prompt.createdAt);
  meta.append(site, "•", time);
  if (prompt.editedAt) {
    const edited = document.createElement("span");
    edited.className = "prompt-card__edited";
    edited.textContent = "Edited";
    meta.append("•", edited);
  }

  let text;
  if (editing) {
    text = document.createElement("textarea");
    text.className = "prompt-card__editor";
    text.value = prompt.text || "";
    text.maxLength = 100000;
    text.dataset.promptEditor = "true";
    text.setAttribute("aria-label", "Edit prompt");
  } else {
    text = document.createElement("p");
    text.className = "prompt-card__text";
    text.textContent = prompt.text;
  }

  const actions = document.createElement("div");
  actions.className = "prompt-card__actions";
  if (editing) {
    actions.append(
      iconActionButton("cancel", "Cancel edit"),
      iconActionButton("save", "Save prompt", true)
    );
  } else {
    actions.append(
      iconActionButton("copy", "Copy prompt"),
      iconActionButton("edit", "Edit prompt"),
      iconActionButton("combine", selected ? "Remove from selection" : "Grab to combine", selected),
      iconActionButton("share", "Share to Prompt Pool"),
      iconActionButton("delete", "Delete prompt", false, true)
    );
  }
  card.append(meta, text, actions);
  return card;
}

function iconActionButton(action, label, selected = false, danger = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `card-icon-button${action === "combine" ? " card-icon-button--grab" : ""}${selected ? " is-selected" : ""}${danger ? " card-icon-button--danger" : ""}`;
  button.dataset.action = action;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = iconSvg(action === "combine" && selected ? "check" : action);
  return button;
}

function iconSvg(name) {
  const paths = {
    copy: '<rect x="9" y="9" width="10" height="10" rx="2"/><path d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/>',
    combine: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 12h8M12 8v8"/>',
    check: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8 12 2.5 2.5L16 9"/>',
    edit: '<path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
    save: '<path d="m5 12 4 4L19 6"/>',
    cancel: '<path d="M6 6l12 12M18 6L6 18"/>',
    share: '<path d="M12 16V4M8 8l4-4 4 4"/><path d="M5 13v6h14v-6"/>',
    delete: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ""}</svg>`;
}

async function handlePromptAction(event) {
  const button = event.target.closest("button[data-action]");
  const card = event.target.closest("[data-id]");
  if (!button || !card) return;
  const prompt = prompts.find((item) => item.id === card.dataset.id);
  if (!prompt) return;

  if (button.dataset.action === "copy") {
    await navigator.clipboard.writeText(prompt.text);
    return;
  }
  if (button.dataset.action === "edit") {
    editingPromptId = prompt.id;
    renderPrompts();
    requestAnimationFrame(() => {
      const editor = elements.promptList.querySelector(`[data-id="${CSS.escape(prompt.id)}"] [data-prompt-editor]`);
      editor?.focus();
      if (editor) editor.setSelectionRange(editor.value.length, editor.value.length);
    });
    return;
  }
  if (button.dataset.action === "cancel") {
    editingPromptId = null;
    renderPrompts();
    return;
  }
  if (button.dataset.action === "save") {
    const editor = card.querySelector("[data-prompt-editor]");
    const text = String(editor?.value || "").trim();
    if (!text) {
      editor?.focus();
      return;
    }
    const original = String(prompt.originalText || prompt.text || "");
    if (text !== prompt.text) {
      prompt.text = text;
      if (text === original) {
        delete prompt.originalText;
        delete prompt.editedAt;
      } else {
        prompt.originalText = original;
        prompt.editedAt = new Date().toISOString();
      }
      await chrome.storage.local.set({ prompts });
    }
    editingPromptId = null;
    renderPrompts();
    renderCombinePanel();
    return;
  }
  if (button.dataset.action === "combine") {
    combineSelection = combineSelection.includes(prompt.id)
      ? combineSelection.filter((id) => id !== prompt.id)
      : [...combineSelection, prompt.id];
    await chrome.storage.local.set({ combineSelection });
    renderPrompts();
    renderCombinePanel();
    return;
  }
  if (button.dataset.action === "share") {
    openPromptPool(prompt.id);
    return;
  }
  if (button.dataset.action === "delete") {
    if (editingPromptId === prompt.id) editingPromptId = null;
    prompts = prompts.filter((item) => item.id !== prompt.id);
    combineSelection = combineSelection.filter((id) => id !== prompt.id);
    await chrome.storage.local.set({ prompts, combineSelection });
    renderPrompts();
    renderCombinePanel();
  }
}

function normalizeSelection(value) {
  const ids = Array.isArray(value) ? value.filter((id) => typeof id === "string") : [];
  const valid = new Set(prompts.map((prompt) => prompt.id));
  return [...new Set(ids)].filter((id) => valid.has(id));
}

function normalizeNoteSelection(value) {
  const ids = Array.isArray(value) ? value.filter((id) => typeof id === "string") : [];
  const valid = new Set(notes.map((n) => n.id));
  return [...new Set(ids)].filter((id) => valid.has(id));
}

function selectedItems() {
  const promptById = new Map(prompts.map((p) => [p.id, p]));
  const noteById = new Map(notes.map((n) => [n.id, n]));
  const items = [];
  for (const id of combineSelection) {
    const p = promptById.get(id);
    if (p) items.push({ text: p.text });
  }
  for (const id of combineNoteSelection) {
    const n = noteById.get(id);
    if (n && (n.title || n.body)) {
      const noteText = [n.title ? `[${n.title}]` : "", n.body].filter(Boolean).join("\n").trim();
      if (noteText) items.push({ text: noteText });
    }
  }
  return items;
}

function renderCombinePanel() {
  combineSelection = normalizeSelection(combineSelection);
  combineNoteSelection = normalizeNoteSelection(combineNoteSelection);
  const count = combineSelection.length + combineNoteSelection.length;
  const activeRuleCount = Core.activeRulesInOrder(rules).length;
  elements.combinePanel.hidden = count === 0;
  elements.combineCount.textContent = count.toLocaleString();
  
  if (activeRuleCount) {
    elements.combineRuleCount.innerHTML = `${activeRuleCount} active ${activeRuleCount === 1 ? "rule" : "rules"} ▾ <br><small>local AI</small>`;
  } else {
    elements.combineRuleCount.innerHTML = `Rules optional ▾ <br><small>local AI</small>`;
  }

  elements.compileCombinedButton.disabled = count === 0;
}

function renderRuleToggleMenu() {
  const sortedRules = [...rules].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return (a.title || "").localeCompare(b.title || "");
  });

  if (sortedRules.length === 0) {
    elements.ruleToggleList.innerHTML = `<div class="rule-toggle-empty">No rules found. Add one in the Rule Book.</div>`;
    return;
  }

  elements.ruleToggleList.replaceChildren(...sortedRules.map((rule) => {
    const label = document.createElement("label");
    label.className = "rule-toggle-item";
    
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = rule.active;
    input.addEventListener("change", async (e) => {
      rule.active = e.target.checked;
      await chrome.storage.local.set({ rules });
      // renderCombinePanel will be called by storage listener
    });

    const text = document.createElement("span");
    text.className = "rule-toggle-text";
    text.textContent = rule.title || "Untitled Rule";

    label.append(input, text);
    return label;
  }));
}

function normalizeNotes(value, legacyQuickNote = "") {
  const input = Array.isArray(value) ? value.slice(0, 100) : [];
  const normalized = input.map((note) => ({
    id: typeof note?.id === "string" && note.id ? note.id : crypto.randomUUID(),
    title: String(note?.title || "").slice(0, 120),
    body: String(note?.body || "").slice(0, 20000),
    createdAt: String(note?.createdAt || new Date().toISOString()),
    updatedAt: String(note?.updatedAt || note?.createdAt || new Date().toISOString())
  }));
  const legacy = String(legacyQuickNote || "").slice(0, 20000);
  if (!normalized.length && legacy.trim()) {
    const now = new Date().toISOString();
    normalized.push({ id: crypto.randomUUID(), title: "", body: legacy, createdAt: now, updatedAt: now });
  }
  return normalized;
}

async function migrateLocalNoteStorage(stored) {
  const shouldWriteNotes = !Array.isArray(stored.notes) && notes.length > 0;
  if (shouldWriteNotes) await chrome.storage.local.set({ notes });
  await chrome.storage.local.remove(["quickNote", "promptOutput"]);
}

function renderNotes(focusId = "") {
  const ordered = [...notes].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  elements.notesEmpty.hidden = ordered.length > 0;
  elements.notesList.replaceChildren(...ordered.map(createNoteCard));
  elements.notesStatus.textContent = ordered.length ? "Saved automatically" : "Auto-saves as you type";
  if (focusId) {
    requestAnimationFrame(() => {
      const body = elements.notesList.querySelector(`[data-note-id="${CSS.escape(focusId)}"] [data-note-field="body"]`);
      body?.focus();
    });
  }
}

function createNoteCard(note) {
  const selected = combineNoteSelection.includes(note.id);
  const card = document.createElement("article");
  card.className = `note-card${selected ? " is-selected" : ""}`;
  card.dataset.noteId = note.id;

  const top = document.createElement("div");
  top.className = "note-card__top";
  const title = document.createElement("input");
  title.className = "note-card__title";
  title.type = "text";
  title.maxLength = 120;
  title.placeholder = "Title";
  title.value = note.title;
  title.dataset.noteField = "title";
  title.setAttribute("aria-label", "Note title");

  // Combine tick button — matches prompt card style
  const combineBtn = document.createElement("button");
  combineBtn.type = "button";
  combineBtn.className = `card-icon-button card-icon-button--grab${selected ? " is-selected" : ""}`;
  combineBtn.dataset.noteAction = "combine";
  combineBtn.title = selected ? "Remove from selection" : "Add note to combine/compile";
  combineBtn.setAttribute("aria-label", combineBtn.title);
  combineBtn.innerHTML = iconSvg(selected ? "check" : "combine");

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "note-card__delete";
  remove.dataset.noteAction = "delete";
  remove.title = "Delete note";
  remove.setAttribute("aria-label", "Delete note");
  remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>';

  const actions = document.createElement("div");
  actions.className = "note-card__actions";
  actions.append(combineBtn, remove);
  top.append(title, actions);

  const body = document.createElement("textarea");
  body.className = "note-card__body";
  body.maxLength = 20000;
  body.placeholder = "Take a note…";
  body.spellcheck = true;
  body.value = note.body;
  body.dataset.noteField = "body";
  body.setAttribute("aria-label", "Note");

  const meta = document.createElement("div");
  meta.className = "note-card__meta";
  meta.textContent = formatNoteTime(note.updatedAt);

  card.append(top, body, meta);
  return card;
}

async function addNote() {
  const now = new Date().toISOString();
  const note = { id: crypto.randomUUID(), title: "", body: "", createdAt: now, updatedAt: now };
  notes.unshift(note);
  await chrome.storage.local.set({ notes });
  renderNotes(note.id);
}

function handleNoteInput(event) {
  const field = event.target.closest("[data-note-field]");
  const card = event.target.closest("[data-note-id]");
  if (!field || !card) return;
  const note = notes.find((item) => item.id === card.dataset.noteId);
  if (!note) return;

  const key = field.dataset.noteField;
  if (key === "title") note.title = String(field.value || "").slice(0, 120);
  if (key === "body") note.body = String(field.value || "").slice(0, 20000);
  note.updatedAt = new Date().toISOString();

  const meta = card.querySelector(".note-card__meta");
  if (meta) meta.textContent = "Saving…";
  elements.notesStatus.textContent = "Saving…";
  const version = ++noteSaveVersion;
  chrome.storage.local.set({ notes }).then(() => {
    if (version !== noteSaveVersion) return;
    elements.notesStatus.textContent = "Saved automatically";
    if (meta?.isConnected) meta.textContent = "Saved just now";
  }).catch(() => {
    if (version === noteSaveVersion) elements.notesStatus.textContent = "Could not save";
  });
}

async function handleNoteAction(event) {
  const button = event.target.closest("button[data-note-action]");
  const card = event.target.closest("[data-note-id]");
  if (!button || !card) return;

  if (button.dataset.noteAction === "combine") {
    const noteId = card.dataset.noteId;
    combineNoteSelection = combineNoteSelection.includes(noteId)
      ? combineNoteSelection.filter((id) => id !== noteId)
      : [...combineNoteSelection, noteId];
    await chrome.storage.local.set({ combineNoteSelection });
    renderNotes();
    renderCombinePanel();
    return;
  }

  if (button.dataset.noteAction === "delete") {
    const noteId = card.dataset.noteId;
    combineNoteSelection = combineNoteSelection.filter((id) => id !== noteId);
    notes = notes.filter((note) => note.id !== noteId);
    await chrome.storage.local.set({ notes, combineNoteSelection });
    globalThis.PromptGrabberSync?.deleteNote?.(noteId);
    renderNotes();
    renderCombinePanel();
  }
}

function formatNoteTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Saved";
  const elapsed = Date.now() - date.getTime();
  if (elapsed < 60000) return "Saved just now";
  if (elapsed < 3600000) return `Saved ${Math.floor(elapsed / 60000)}m ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function openResultDialog(mode, text, meta = "") {
  const compiled = mode === "compiled";
  elements.resultMode.textContent = compiled ? "Compiled" : "Combined";
  elements.resultMode.classList.toggle("result-mode--ai", compiled);
  elements.resultTitle.textContent = compiled ? "Compiled prompt" : "Combined prompt";
  elements.resultMeta.textContent = meta || (compiled ? "Local AI · not saved" : "Exact text · not saved");
  elements.resultText.value = text;
  elements.copyResultButton.textContent = "Copy prompt";
  if (!elements.resultDialog.open) elements.resultDialog.showModal();
  requestAnimationFrame(() => elements.resultText.focus());
}

function closeResultDialog() {
  if (elements.resultDialog.open) elements.resultDialog.close();
}

async function copyResultText() {
  const text = String(elements.resultText.value || "");
  if (!text.trim()) return;
  await navigator.clipboard.writeText(text);
  elements.copyResultButton.textContent = "Copied";
  setTimeout(() => { if (elements.copyResultButton.isConnected) elements.copyResultButton.textContent = "Copy prompt"; }, 900);
}

async function createCombinedOutput() {
  const selected = selectedItems();
  if (!selected.length) return;
  const activeRules = Core.activeRulesInOrder(rules);
  const value = Core.buildStructuredPrompt(selected, activeRules);
  elements.resultTitle.textContent = "Combined Prompts";
  
  if (activeRules.length > 0) {
    elements.resultMeta.textContent = `${activeRules.length} ${activeRules.length === 1 ? "rule" : "rules"} applied · ${selected.length} items`;
  } else {
    elements.resultMeta.textContent = `${selected.length} items`;
  }
  
  elements.resultMode.textContent = "Raw Text";
  elements.resultMode.className = "result-mode";
  elements.resultText.value = value;
  elements.resultDialog.showModal();
}

async function compileSelection() {
  const selected = selectedItems();
  if (!selected.length) return;
  const activeRuleCount = Core.activeRulesInOrder(rules).length;

  const button = elements.compileCombinedButton;
  button.disabled = true;
  button.textContent = "AI…";
  elements.combineRuleCount.textContent = "Checking local AI…";

  try {
    const result = await AI.compile(selected, rules, {
      onStatus(message) { elements.combineRuleCount.textContent = message.replace(/on-device/gi, "local"); }
    });
    openResultDialog(
      "compiled",
      result,
      activeRuleCount ? `${activeRuleCount} active ${activeRuleCount === 1 ? "rule" : "rules"} · not saved` : "No rules · not saved"
    );
  } catch (error) {
    button.textContent = "Unavailable";
    elements.combineRuleCount.textContent = error?.message || "Local AI unavailable";
    setTimeout(() => {
      button.textContent = "Compile";
      renderCombinePanel();
    }, 1800);
    return;
  } finally {
    if (button.textContent !== "Unavailable") {
      button.textContent = "Compile";
      renderCombinePanel();
    }
  }
}

async function clearCombineSelection() {
  combineSelection = [];
  combineNoteSelection = [];
  await chrome.storage.local.set({ combineSelection, combineNoteSelection });
  renderPrompts();
  renderNotes();
  renderCombinePanel();
}

async function saveSettings() {
  settings = Core.mergeSettings(settings);
  await chrome.storage.local.set({ settings });
}


function openPromptPool(sharePromptId = "") {
  const url = new URL(chrome.runtime.getURL("pool.html"));
  if (sharePromptId) url.searchParams.set("share", sharePromptId);
  chrome.tabs.create({ url: url.toString() });
}

function readableName(hostname) {
  const first = hostname.replace(/^www\./, "").split(".")[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function formatRelativeTime(dateValue) {
  const elapsed = Date.now() - Date.parse(dateValue);
  if (!Number.isFinite(elapsed) || elapsed < 0) return "now";
  if (elapsed < 60000) return "just now";
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)}m ago`;
  if (elapsed < 86400000) return `${Math.floor(elapsed / 3600000)}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(dateValue));
}
