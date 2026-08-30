"use strict";

const Core = globalThis.PromptGrabberCore;
const AI = globalThis.PromptGrabberAI;
const PAGE_SIZE = 30;
const els = Object.fromEntries([
  "openPromptPoolButton", "syncStatus", "enabledSetting", "captureOnEnterSetting", "toastSetting", "captureUrlSetting", "maxPromptsSetting",
  "supportedSiteList", "customSiteList", "customSiteEmpty", "totalStat", "siteStat", "todayStat",
  "searchInput", "siteFilter", "dateFilter", "sortOrder", "resultCount", "historyEmpty", "historyList",
  "loadMoreButton", "exportJsonButton", "exportCsvButton", "clearAllButton", "clearDialog", "toast",
  "ruleBookButton", "manageRulesButton", "ruleTotalStat", "ruleActiveStat", "combineTray", "combineCount", "combineRuleHint",
  "clearCombineButton", "combineButton", "compileButton", "ruleBookDialog", "addRuleButton", "emptyAddRuleButton", "closeRuleBookButton",
  "ruleSearchInput", "ruleBookCount", "ruleEmpty", "ruleList", "ruleEditorDialog", "ruleEditorForm", "ruleEditorTitle",
  "editingRuleId", "ruleTitleInput", "ruleRoleInput", "ruleContextInput", "ruleMustInput", "ruleMustNotInput", "ruleShouldInput", "ruleOutputInput",
  "ruleCorrectExampleInput", "ruleIncorrectExampleInput", "ruleRoleCount", "ruleContextCount", "ruleMustCount", "ruleMustNotCount", "ruleShouldCount",
  "ruleOutputCount", "ruleCorrectExampleCount", "ruleIncorrectExampleCount", "ruleActiveInput", "closeRuleEditorButton", "cancelRuleButton",
  "promptEditDialog", "promptEditForm", "editingPromptId", "promptEditInput", "promptEditCount", "closePromptEditButton", "cancelPromptEditButton",
  "managerNoteCount", "managerNotesStatus", "managerAddNoteButton", "managerNotesEmpty", "managerNotesList",
  "resultDialog", "resultMode", "resultTitle", "resultMeta", "resultText", "closeResultButton", "closeResultFooterButton", "copyResultButton"
].map((id) => [id, document.querySelector(`#${id}`)]));

let settings = Core.mergeSettings();
let prompts = [];
let rules = [];
let combineSelection = [];
let notes = [];
let noteSaveVersion = 0;
let visibleCount = PAGE_SIZE;
let toastTimer = null;
let reopenRuleBookAfterEditor = false;

initialize().catch(() => showToast("Unable to load prompt history"));

async function initialize() {
  const stored = await chrome.storage.local.get(["settings", "prompts", "rules", "combineSelection", "notes", "quickNote"]);
  settings = Core.mergeSettings(stored.settings);
  prompts = Array.isArray(stored.prompts) ? stored.prompts : [];
  rules = Core.normalizeRules(stored.rules);
  combineSelection = normalizeSelection(stored.combineSelection);
  notes = normalizeNotes(stored.notes, stored.quickNote);

  renderSettings();
  renderSupportedSites();
  renderCustomSites();
  updateFilters();
  renderHistory();
  renderRules();
  renderCombineTray();
  renderManagerNotes();
  bindEvents();
  await migrateLocalNoteStorage(stored);

  if (location.hash === "#rules") openRuleBook();

  if (globalThis.PromptGrabberSync) {
    globalThis.PromptGrabberSync.onStatusChange((status) => {
      if (!els.syncStatus) return;
      els.syncStatus.dataset.status = status;
      if (status === "synced") {
        els.syncStatus.textContent = "✓ Synced";
        els.syncStatus.style.display = "";
      } else if (status === "syncing") {
        els.syncStatus.textContent = "Syncing…";
        els.syncStatus.style.display = "";
      } else if (status === "offline") {
        els.syncStatus.textContent = "⚠ Offline";
        els.syncStatus.style.display = "";
      } else {
        els.syncStatus.style.display = "none";
      }
    });
    globalThis.PromptGrabberSync.start();
  }
}

function bindEvents() {
  els.openPromptPoolButton.addEventListener("click", () => openPromptPool());
  [els.enabledSetting, els.captureOnEnterSetting, els.toastSetting, els.captureUrlSetting, els.maxPromptsSetting]
    .forEach((element) => element.addEventListener("change", updateSettingsFromForm));

  els.searchInput.addEventListener("input", resetAndRender);
  els.siteFilter.addEventListener("change", resetAndRender);
  els.dateFilter.addEventListener("change", resetAndRender);
  els.sortOrder.addEventListener("change", resetAndRender);
  els.loadMoreButton.addEventListener("click", () => { visibleCount += PAGE_SIZE; renderHistory(); });
  els.historyList.addEventListener("click", handleHistoryAction);
  els.promptEditForm.addEventListener("submit", savePromptEdit);
  els.promptEditInput.addEventListener("input", updatePromptEditCount);
  els.closePromptEditButton.addEventListener("click", closePromptEditor);
  els.cancelPromptEditButton.addEventListener("click", closePromptEditor);
  els.customSiteList.addEventListener("click", handleCustomSiteAction);
  els.exportJsonButton.addEventListener("click", exportJson);
  els.exportCsvButton.addEventListener("click", exportCsv);
  els.clearAllButton.addEventListener("click", () => els.clearDialog.showModal());
  els.clearDialog.addEventListener("close", clearPromptHistoryIfConfirmed);

  els.ruleBookButton.addEventListener("click", openRuleBook);
  els.manageRulesButton.addEventListener("click", openRuleBook);
  els.closeRuleBookButton.addEventListener("click", () => els.ruleBookDialog.close());
  els.addRuleButton.addEventListener("click", () => openRuleEditor());
  els.emptyAddRuleButton.addEventListener("click", () => openRuleEditor());
  els.ruleSearchInput.addEventListener("input", renderRules);
  els.ruleList.addEventListener("click", handleRuleAction);
  els.ruleList.addEventListener("change", handleRuleToggle);
  els.ruleEditorForm.addEventListener("submit", saveRuleFromForm);
  [els.ruleRoleInput, els.ruleContextInput, els.ruleMustInput, els.ruleMustNotInput, els.ruleShouldInput, els.ruleOutputInput, els.ruleCorrectExampleInput, els.ruleIncorrectExampleInput].forEach((field) => field.addEventListener("input", updateRuleCounts));
  els.closeRuleEditorButton.addEventListener("click", closeRuleEditor);
  els.cancelRuleButton.addEventListener("click", closeRuleEditor);
  els.ruleEditorDialog.addEventListener("close", () => {
    if (reopenRuleBookAfterEditor && !els.ruleBookDialog.open) {
      reopenRuleBookAfterEditor = false;
      openRuleBook();
    }
  });

  els.clearCombineButton.addEventListener("click", clearCombineSelection);
  els.combineButton.addEventListener("click", copyCombinedPrompts);
  els.compileButton.addEventListener("click", compileSelection);
  els.closeResultButton.addEventListener("click", closeResultDialog);
  els.closeResultFooterButton.addEventListener("click", closeResultDialog);
  els.copyResultButton.addEventListener("click", copyResultText);

  els.managerAddNoteButton.addEventListener("click", addManagerNote);
  els.managerNotesList.addEventListener("input", handleManagerNoteInput);
  els.managerNotesList.addEventListener("click", handleManagerNoteAction);

  chrome.storage.onChanged.addListener(handleStorageChange);
}

function handleStorageChange(changes, areaName) {
  if (areaName !== "local") return;
  if (changes.prompts) {
    prompts = Array.isArray(changes.prompts.newValue) ? changes.prompts.newValue : [];
    combineSelection = normalizeSelection(combineSelection);
    updateFilters();
    renderHistory();
    renderCombineTray();
  }
  if (changes.rules) {
    rules = Core.normalizeRules(changes.rules.newValue);
    renderRules();
    renderCombineTray();
  }
  if (changes.combineSelection) {
    combineSelection = normalizeSelection(changes.combineSelection.newValue);
    renderHistory();
    renderCombineTray();
  }
  if (changes.notes) {
    notes = normalizeNotes(changes.notes.newValue);
    const editingNote = document.activeElement?.closest?.("[data-note-id]");
    if (!editingNote) renderManagerNotes();
    else els.managerNoteCount.textContent = `${notes.length.toLocaleString()} ${notes.length === 1 ? "note" : "notes"}`;
  }
}

function renderSettings() {
  els.enabledSetting.checked = settings.enabled;
  els.captureOnEnterSetting.checked = settings.captureOnEnter;
  els.toastSetting.checked = settings.showActivationToast;
  els.captureUrlSetting.checked = settings.captureUrl;
  els.maxPromptsSetting.value = String(settings.maxPrompts);
}

async function updateSettingsFromForm() {
  settings = Core.mergeSettings({
    ...settings,
    enabled: els.enabledSetting.checked,
    captureOnEnter: els.captureOnEnterSetting.checked,
    showActivationToast: els.toastSetting.checked,
    captureUrl: els.captureUrlSetting.checked,
    maxPrompts: Number(els.maxPromptsSetting.value)
  });

  if (prompts.length > settings.maxPrompts) {
    prompts.length = settings.maxPrompts;
    combineSelection = normalizeSelection(combineSelection);
    await chrome.storage.local.set({ settings, prompts, combineSelection });
  } else {
    await chrome.storage.local.set({ settings });
  }
  renderHistory();
  renderCombineTray();
  showToast("Settings saved");
}

function renderSupportedSites() {
  const unique = [...new Map(Core.SITES.map((site) => [site.id, site])).values()];
  els.supportedSiteList.replaceChildren(...unique.map((site) => {
    const row = document.createElement("div");
    row.className = "site-item";
    const name = document.createElement("span");
    name.textContent = site.name;
    const status = document.createElement("small");
    status.textContent = "AUTO";
    row.append(name, status);
    return row;
  }));
}

function renderCustomSites() {
  els.customSiteEmpty.hidden = settings.customOrigins.length > 0;
  els.customSiteList.replaceChildren(...settings.customOrigins.map((origin) => {
    const row = document.createElement("div");
    row.className = "custom-site-item";
    const label = document.createElement("span");
    label.textContent = origin;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-site";
    remove.dataset.origin = origin;
    remove.textContent = "Remove";
    row.append(label, remove);
    return row;
  }));
}

async function handleCustomSiteAction(event) {
  const button = event.target.closest("button[data-origin]");
  if (!button) return;
  const origin = button.dataset.origin;
  const pattern = Core.originToMatchPattern(origin);
  settings.customOrigins = settings.customOrigins.filter((item) => item !== origin);
  settings.blockedSites = settings.blockedSites.filter((item) => item !== origin);
  await chrome.storage.local.set({ settings });
  if (pattern) await chrome.permissions.remove({ origins: [pattern] });
  await chrome.runtime.sendMessage({ type: "REFRESH_CUSTOM_SITES" });
  renderCustomSites();
  showToast("Site removed");
}

function updateFilters() {
  const value = els.siteFilter.value;
  const sites = [...new Map(prompts.map((prompt) => [prompt.siteId, prompt.siteName || prompt.siteId])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  els.siteFilter.replaceChildren(option("all", "All AI sites"), ...sites.map(([id, name]) => option(id, name)));
  els.siteFilter.value = sites.some(([id]) => id === value) ? value : "all";
}

function option(value, label) {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

function resetAndRender() {
  visibleCount = PAGE_SIZE;
  renderHistory();
}

function filteredPrompts() {
  const query = els.searchInput.value.trim().toLowerCase();
  const site = els.siteFilter.value;
  const date = els.dateFilter.value;
  const now = Date.now();
  const todayStart = startOfToday();
  const cutoffs = { today: todayStart, week: now - 7 * 86400000, month: now - 30 * 86400000 };

  const result = prompts.filter((prompt) => {
    if (site !== "all" && prompt.siteId !== site) return false;
    const createdAt = Date.parse(prompt.createdAt);
    if (date === "yesterday") {
      const yesterdayStart = todayStart - 86400000;
      if (createdAt < yesterdayStart || createdAt >= todayStart) return false;
    } else if (date !== "all" && createdAt < cutoffs[date]) return false;
    if (!query) return true;
    return [prompt.text, prompt.siteName, prompt.pageTitle].some((value) => String(value || "").toLowerCase().includes(query));
  });

  return result.sort((a, b) => {
    const difference = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    return els.sortOrder.value === "oldest" ? -difference : difference;
  });
}

function renderHistory() {
  const result = filteredPrompts();
  const visible = result.slice(0, visibleCount);
  els.historyList.replaceChildren(...visible.map(createHistoryCard));
  els.historyEmpty.hidden = result.length > 0;
  els.loadMoreButton.hidden = visible.length >= result.length;
  els.resultCount.textContent = `${result.length.toLocaleString()} ${result.length === 1 ? "prompt" : "prompts"}`;
  renderStats();
}

function renderStats() {
  els.totalStat.textContent = prompts.length.toLocaleString();
  els.siteStat.textContent = new Set(prompts.map((prompt) => prompt.siteId)).size.toLocaleString();
  const today = startOfToday();
  els.todayStat.textContent = prompts.filter((prompt) => Date.parse(prompt.createdAt) >= today).length.toLocaleString();
}

function createHistoryCard(prompt) {
  const selected = combineSelection.includes(prompt.id);
  const card = document.createElement("article");
  card.className = `history-card${selected ? " is-selected" : ""}`;
  card.dataset.id = prompt.id;

  const header = document.createElement("div");
  header.className = "history-card__header";
  const site = document.createElement("span");
  site.className = "site-pill";
  site.textContent = prompt.siteName || "AI site";
  const date = document.createElement("time");
  date.dateTime = prompt.createdAt;
  date.textContent = formatDate(prompt.createdAt);
  header.append(site, date);
  if (prompt.editedAt) {
    const edited = document.createElement("span");
    edited.className = "edited-pill";
    edited.textContent = "Edited";
    edited.title = `Edited ${formatDate(prompt.editedAt)}`;
    header.append(edited);
  }

  const text = document.createElement("div");
  text.className = "history-card__text";
  text.textContent = prompt.text;

  const footer = document.createElement("div");
  footer.className = "history-card__footer";
  const source = prompt.url ? document.createElement("a") : document.createElement("span");
  source.className = "source-link";
  source.textContent = prompt.pageTitle || prompt.url || "Source not stored";
  source.title = prompt.url || "";
  if (prompt.url) {
    source.href = prompt.url;
    source.target = "_blank";
    source.rel = "noreferrer";
  }

  const actions = document.createElement("div");
  actions.className = "card-actions";
  actions.append(
    iconActionButton("copy", "Copy prompt"),
    iconActionButton("edit", "Edit prompt"),
    iconActionButton("combine", selected ? "Remove from selection" : "Grab to combine", selected),
    iconActionButton("share", "Share to Prompt Pool"),
    iconActionButton("delete", "Delete prompt", false, true)
  );
  footer.append(source, actions);
  card.append(header, text, footer);
  return card;
}

function iconActionButton(action, label, selected = false, danger = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `card-icon-button${action === "combine" ? " card-icon-button--grab" : ""}${selected ? " is-selected" : ""}${danger ? " card-icon-button--danger" : ""}`;
  button.dataset.action = action;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = iconSvg(action === "combine" && selected ? "check" : action);
  return button;
}

function iconSvg(name) {
  const paths = {
    copy: '<rect x="9" y="9" width="10" height="10" rx="2"/><path d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/>',
    combine: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 12h8M12 8v8"/>',
    check: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8 12 2.5 2.5L16 9"/>',
    edit: '<path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
    share: '<path d="M12 16V4M8 8l4-4 4 4"/><path d="M5 13v6h14v-6"/>',
    delete: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ""}</svg>`;
}

async function handleHistoryAction(event) {
  const button = event.target.closest("button[data-action]");
  const card = event.target.closest("[data-id]");
  if (!button || !card) return;
  const prompt = prompts.find((item) => item.id === card.dataset.id);
  if (!prompt) return;

  if (button.dataset.action === "copy") {
    await navigator.clipboard.writeText(prompt.text);
    showToast("Copied");
    return;
  }
  if (button.dataset.action === "edit") {
    openPromptEditor(prompt);
    return;
  }
  if (button.dataset.action === "combine") {
    await toggleCombinePrompt(prompt.id);
    return;
  }
  if (button.dataset.action === "share") {
    openPromptPool(prompt.id);
    return;
  }
  if (button.dataset.action === "delete") {
    prompts = prompts.filter((item) => item.id !== prompt.id);
    combineSelection = combineSelection.filter((id) => id !== prompt.id);
    await chrome.storage.local.set({ prompts, combineSelection });
    updateFilters();
    renderHistory();
    renderCombineTray();
    showToast("Deleted");
  }
}

function openPromptEditor(prompt) {
  els.editingPromptId.value = prompt.id;
  els.promptEditInput.value = prompt.text || "";
  updatePromptEditCount();
  els.promptEditDialog.showModal();
  requestAnimationFrame(() => {
    els.promptEditInput.focus();
    els.promptEditInput.setSelectionRange(els.promptEditInput.value.length, els.promptEditInput.value.length);
  });
}

function closePromptEditor() {
  els.promptEditDialog.close();
}

function updatePromptEditCount() {
  els.promptEditCount.textContent = els.promptEditInput.value.length.toLocaleString();
}

async function savePromptEdit(event) {
  event.preventDefault();
  const prompt = prompts.find((item) => item.id === els.editingPromptId.value);
  if (!prompt) {
    els.promptEditDialog.close();
    return;
  }

  const text = String(els.promptEditInput.value || "").trim();
  if (!text) {
    showToast("Prompt cannot be empty");
    els.promptEditInput.focus();
    return;
  }
  if (text.length > 100000) {
    showToast("Prompt is too long");
    return;
  }

  const original = String(prompt.originalText || prompt.text || "");
  if (text === prompt.text) {
    els.promptEditDialog.close();
    return;
  }

  prompt.text = text;
  if (text === original) {
    delete prompt.originalText;
    delete prompt.editedAt;
  } else {
    prompt.originalText = original;
    prompt.editedAt = new Date().toISOString();
  }

  await chrome.storage.local.set({ prompts });
  globalThis.PromptGrabberSync?.pushPrompt(prompt);
  renderHistory();
  renderCombineTray();
  els.promptEditDialog.close();
  showToast("Prompt updated");
}

async function clearPromptHistoryIfConfirmed() {
  if (els.clearDialog.returnValue !== "confirm") return;
  prompts = [];
  combineSelection = [];
  await chrome.storage.local.set({ prompts, combineSelection });
  globalThis.PromptGrabberSync?.clearPrompts();
  updateFilters();
  renderHistory();
  renderCombineTray();
  showToast("History cleared");
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
  if (!Array.isArray(stored.notes) && notes.length > 0) await chrome.storage.local.set({ notes });
  if (Object.prototype.hasOwnProperty.call(stored, "quickNote")) await chrome.storage.local.remove("quickNote");
}

function renderManagerNotes(focusId = "") {
  const ordered = [...notes].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  els.managerNotesEmpty.hidden = ordered.length > 0;
  els.managerNotesList.replaceChildren(...ordered.map(createManagerNoteCard));
  els.managerNoteCount.textContent = `${ordered.length.toLocaleString()} ${ordered.length === 1 ? "note" : "notes"}`;
  if (!els.managerNotesStatus.textContent || els.managerNotesStatus.textContent === "Saving…") {
    els.managerNotesStatus.textContent = ordered.length ? "Saved automatically" : "Auto-saves as you type";
  }
  if (focusId) {
    requestAnimationFrame(() => {
      const card = els.managerNotesList.querySelector(`[data-note-id="${CSS.escape(focusId)}"]`);
      const field = card?.querySelector('[data-note-field="body"]');
      field?.focus();
    });
  }
}

function createManagerNoteCard(note) {
  const card = document.createElement("article");
  card.className = "history-card manager-note-card";
  card.dataset.noteId = note.id;

  const header = document.createElement("div");
  header.className = "history-card__header manager-note-card__header";
  const pill = document.createElement("span");
  pill.className = "site-pill manager-note-pill";
  pill.textContent = "Note";
  const time = document.createElement("time");
  time.dateTime = note.updatedAt;
  time.textContent = formatNoteTime(note.updatedAt);
  header.append(pill, time);

  const title = document.createElement("input");
  title.type = "text";
  title.maxLength = 120;
  title.className = "manager-note-card__title";
  title.placeholder = "Title";
  title.value = note.title;
  title.dataset.noteField = "title";
  title.setAttribute("aria-label", "Note title");

  const body = document.createElement("textarea");
  body.maxLength = 20000;
  body.className = "manager-note-card__body";
  body.placeholder = "Take a note…";
  body.spellcheck = true;
  body.value = note.body;
  body.dataset.noteField = "body";
  body.setAttribute("aria-label", "Note");

  const footer = document.createElement("div");
  footer.className = "history-card__footer manager-note-card__footer";
  const status = document.createElement("span");
  status.className = "source-link manager-note-card__status";
  status.textContent = "Saved automatically";

  const actions = document.createElement("div");
  actions.className = "card-actions";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "card-icon-button card-icon-button--danger";
  remove.dataset.noteAction = "delete";
  remove.title = "Delete note";
  remove.setAttribute("aria-label", "Delete note");
  remove.innerHTML = iconSvg("delete");
  actions.append(remove);
  footer.append(status, actions);

  card.append(header, title, body, footer);
  return card;
}

async function addManagerNote() {
  const now = new Date().toISOString();
  const note = { id: crypto.randomUUID(), title: "", body: "", createdAt: now, updatedAt: now };
  notes.unshift(note);
  await chrome.storage.local.set({ notes });
  globalThis.PromptGrabberSync?.pushNote(note);
  renderManagerNotes(note.id);
  showToast("Note created");
}

function handleManagerNoteInput(event) {
  const field = event.target.closest("[data-note-field]");
  const card = event.target.closest("[data-note-id]");
  if (!field || !card) return;
  const note = notes.find((item) => item.id === card.dataset.noteId);
  if (!note) return;

  const key = field.dataset.noteField;
  if (key === "title") note.title = String(field.value || "").slice(0, 120);
  if (key === "body") note.body = String(field.value || "").slice(0, 20000);
  note.updatedAt = new Date().toISOString();

  const status = card.querySelector(".manager-note-card__status");
  const time = card.querySelector("time");
  if (status) status.textContent = "Saving…";
  if (time) time.textContent = "just now";
  els.managerNotesStatus.textContent = "Saving…";

  const version = ++noteSaveVersion;
  chrome.storage.local.set({ notes }).then(() => {
    if (version !== noteSaveVersion) return;
    els.managerNotesStatus.textContent = "Saved automatically";
    if (status?.isConnected) status.textContent = "Saved automatically";
    globalThis.PromptGrabberSync?.pushNote(note);
  }).catch(() => {
    if (version === noteSaveVersion) {
      els.managerNotesStatus.textContent = "Could not save";
      if (status?.isConnected) status.textContent = "Could not save";
    }
  });
}

async function handleManagerNoteAction(event) {
  const button = event.target.closest("button[data-note-action]");
  const card = event.target.closest("[data-note-id]");
  if (!button || !card || button.dataset.noteAction !== "delete") return;
  const noteId = card.dataset.noteId;
  notes = notes.filter((note) => note.id !== noteId);
  await chrome.storage.local.set({ notes });
  globalThis.PromptGrabberSync?.deleteNote(noteId);
  renderManagerNotes();
  showToast("Note deleted");
}

function formatNoteTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Saved";
  const elapsed = Date.now() - date.getTime();
  if (elapsed < 60000) return "just now";
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)}m ago`;
  if (elapsed < 86400000) return `${Math.floor(elapsed / 3600000)}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function normalizeSelection(value) {
  const ids = Array.isArray(value) ? value.filter((id) => typeof id === "string") : [];
  const valid = new Set(prompts.map((prompt) => prompt.id));
  return [...new Set(ids)].filter((id) => valid.has(id));
}

function selectedPrompts() {
  const byId = new Map(prompts.map((prompt) => [prompt.id, prompt]));
  return combineSelection.map((id) => byId.get(id)).filter(Boolean);
}

async function toggleCombinePrompt(promptId) {
  const alreadySelected = combineSelection.includes(promptId);
  combineSelection = alreadySelected
    ? combineSelection.filter((id) => id !== promptId)
    : [...combineSelection, promptId];
  await chrome.storage.local.set({ combineSelection });
  renderHistory();
  renderCombineTray();
  showToast(alreadySelected ? "Removed" : "Grabbed");
}

function renderCombineTray() {
  combineSelection = normalizeSelection(combineSelection);
  const count = combineSelection.length;
  const activeRuleCount = Core.activeRulesInOrder(rules).length;
  els.combineTray.hidden = count === 0;
  els.combineCount.textContent = count.toLocaleString();
  els.combineRuleHint.textContent = activeRuleCount
    ? `${activeRuleCount} active ${activeRuleCount === 1 ? "rule" : "rules"} · local AI`
    : "Local AI compile · rules optional";
  els.compileButton.disabled = count === 0;
  els.compileButton.title = activeRuleCount
    ? "Compile with local AI and active rules"
    : "Compile with local AI without rules";
}

async function clearCombineSelection() {
  combineSelection = [];
  await chrome.storage.local.set({ combineSelection });
  renderHistory();
  renderCombineTray();
  showToast("Selection cleared");
}

function openResultDialog(mode, text, meta = "") {
  const compiled = mode === "compiled";
  els.resultMode.textContent = compiled ? "Compiled" : "Combined";
  els.resultMode.classList.toggle("result-mode--ai", compiled);
  els.resultTitle.textContent = compiled ? "Compiled prompt" : "Combined prompt";
  els.resultMeta.textContent = meta || (compiled ? "Local AI result · not saved" : "Exact prompt text · not saved");
  els.resultText.value = text;
  els.copyResultButton.textContent = "Copy prompt";
  if (!els.resultDialog.open) els.resultDialog.showModal();
  requestAnimationFrame(() => els.resultText.focus());
}

function closeResultDialog() {
  if (els.resultDialog.open) els.resultDialog.close();
}

async function copyResultText() {
  const text = String(els.resultText.value || "");
  if (!text.trim()) return;
  await navigator.clipboard.writeText(text);
  els.copyResultButton.textContent = "Copied";
  setTimeout(() => { if (els.copyResultButton.isConnected) els.copyResultButton.textContent = "Copy prompt"; }, 900);
}

async function copyCombinedPrompts() {
  const chosen = selectedPrompts();
  if (!chosen.length) return showToast("Grab at least one prompt");
  const text = Core.buildRawCombinedPrompt(chosen);
  if (!text) return;
  openResultDialog("combined", text, `${chosen.length} ${chosen.length === 1 ? "prompt" : "prompts"} · unchanged`);
}

async function compileSelection() {
  const chosen = selectedPrompts();
  if (!chosen.length) return showToast("Grab at least one prompt");
  const activeRuleCount = Core.activeRulesInOrder(rules).length;

  const originalLabel = els.compileButton.textContent;
  els.compileButton.disabled = true;
  els.compileButton.textContent = "Compiling…";
  els.combineRuleHint.textContent = "Checking local AI…";

  try {
    const result = await AI.compile(chosen, rules, {
      onStatus(message) { els.combineRuleHint.textContent = message.replace(/on-device/gi, "local"); }
    });
    openResultDialog(
      "compiled",
      result,
      activeRuleCount ? `${activeRuleCount} active ${activeRuleCount === 1 ? "rule" : "rules"} · not saved` : "No rules · not saved"
    );
  } catch (error) {
    showToast(error?.message || "Local AI compilation failed");
  } finally {
    els.compileButton.textContent = originalLabel;
    renderCombineTray();
  }
}

function renderRuleStats() {
  els.ruleTotalStat.textContent = rules.length.toLocaleString();
  els.ruleActiveStat.textContent = rules.filter((rule) => rule.active).length.toLocaleString();
}

function openRuleBook() {
  renderRules();
  if (!els.ruleBookDialog.open) els.ruleBookDialog.showModal();
}

function filteredRules() {
  const query = els.ruleSearchInput.value.trim().toLowerCase();
  return [...rules]
    .filter((rule) => !query || [rule.title, rule.role, rule.context, rule.must, rule.mustNot, rule.should, rule.outputFormat, rule.correctExample, rule.incorrectExample].some((value) => String(value || "").toLowerCase().includes(query)))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.title.localeCompare(b.title));
}

function renderRules() {
  const result = filteredRules();
  els.ruleBookCount.textContent = `${result.length.toLocaleString()} ${result.length === 1 ? "rule" : "rules"}`;
  els.ruleEmpty.hidden = rules.length > 0;
  els.ruleList.hidden = result.length === 0;
  els.ruleList.replaceChildren(...result.map(createRuleCard));
  renderRuleStats();
}

function createRuleCard(rule) {
  const card = document.createElement("article");
  card.className = `rule-card${rule.active ? "" : " rule-card--inactive"}`;
  card.dataset.ruleId = rule.id;

  const top = document.createElement("div");
  top.className = "rule-card__top";
  const titleWrap = document.createElement("div");
  titleWrap.className = "rule-card__title";
  const title = document.createElement("strong");
  title.textContent = rule.title;
  const state = document.createElement("span");
  state.className = "rule-state";
  state.textContent = rule.active ? "Used in compile" : "Ignored";
  titleWrap.append(title, state);

  const actions = document.createElement("div");
  actions.className = "rule-card__actions";
  const toggle = document.createElement("label");
  toggle.className = "switch switch--compact rule-card__switch";
  toggle.title = rule.active ? "Turn rule off" : "Turn rule on";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = rule.active;
  input.dataset.ruleAction = "toggle";
  input.setAttribute("aria-label", `${rule.active ? "Disable" : "Enable"} ${rule.title}`);
  const track = document.createElement("span");
  track.className = "switch-track";
  toggle.append(input, track);
  actions.append(toggle, ruleIconButton("edit", "Edit rule"), ruleIconButton("delete", "Delete rule", true));
  top.append(titleWrap, actions);

  const body = document.createElement("div");
  body.className = "rule-card__body";
  const sections = [
    ["Role", rule.role], ["Context", rule.context], ["Must", rule.must], ["Must not", rule.mustNot], ["Should", rule.should],
    ["Output", rule.outputFormat], ["Correct", rule.correctExample], ["Avoid", rule.incorrectExample]
  ].filter(([, value]) => value);
  body.append(...sections.slice(0, 4).map(([label, value]) => ruleSection(label, value)));
  if (sections.length > 4) {
    const more = document.createElement("small");
    more.className = "rule-card__more";
    more.textContent = `+${sections.length - 4} more`;
    body.append(more);
  }

  const footer = document.createElement("div");
  footer.className = "rule-card__footer";
  const version = document.createElement("small");
  version.textContent = `Updated ${formatDate(rule.updatedAt)}`;
  footer.append(version);

  card.append(top, body, footer);
  return card;
}

function ruleIconButton(action, label, danger = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `rule-icon-button${danger ? " rule-icon-button--danger" : ""}`;
  button.dataset.ruleAction = action;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = iconSvg(action);
  return button;
}

function ruleSection(label, value) {
  const section = document.createElement("div");
  section.className = "rule-card__section";
  const heading = document.createElement("span");
  heading.textContent = label;
  const text = document.createElement("p");
  text.textContent = value;
  section.append(heading, text);
  return section;
}

async function handleRuleToggle(event) {
  const input = event.target.closest('input[data-rule-action="toggle"]');
  const card = event.target.closest("[data-rule-id]");
  if (!input || !card) return;
  const rule = rules.find((item) => item.id === card.dataset.ruleId);
  if (!rule) return;
  const now = new Date().toISOString();
  const updated = { ...rule, active: input.checked, updatedAt: now };
  updated.versions = [...(rule.versions || []), manualVersion(updated, now)].slice(-50);
  rules = rules.map((item) => item.id === rule.id ? updated : item);
  await saveRules();
  showToast(updated.active ? "Rule on" : "Rule off");
}

async function handleRuleAction(event) {
  const button = event.target.closest("button[data-rule-action]");
  const card = event.target.closest("[data-rule-id]");
  if (!button || !card) return;
  const rule = rules.find((item) => item.id === card.dataset.ruleId);
  if (!rule) return;

  if (button.dataset.ruleAction === "edit") {
    openRuleEditor(rule);
    return;
  }

  if (button.dataset.ruleAction === "delete") {
    if (button.dataset.confirmDelete !== "true") {
      button.dataset.confirmDelete = "true";
      button.classList.add("is-confirming");
      button.title = "Click again to confirm";
      setTimeout(() => {
        if (button.isConnected) {
          button.dataset.confirmDelete = "false";
          button.classList.remove("is-confirming");
          button.title = "Delete rule";
        }
      }, 2200);
      return;
    }
    rules = rules.filter((item) => item.id !== rule.id);
    await saveRules();
    showToast("Rule deleted");
  }
}

function openRuleEditor(rule = null) {
  reopenRuleBookAfterEditor = els.ruleBookDialog.open;
  if (els.ruleBookDialog.open) els.ruleBookDialog.close();

  els.editingRuleId.value = rule?.id || "";
  els.ruleEditorTitle.textContent = rule ? "Edit rule" : "Create rule";
  els.ruleTitleInput.value = rule?.title || "";
  els.ruleRoleInput.value = rule?.role || "";
  els.ruleContextInput.value = rule?.context || "";
  els.ruleMustInput.value = rule?.must || "";
  els.ruleMustNotInput.value = rule?.mustNot || "";
  els.ruleShouldInput.value = rule?.should || "";
  els.ruleOutputInput.value = rule?.outputFormat || "";
  els.ruleCorrectExampleInput.value = rule?.correctExample || "";
  els.ruleIncorrectExampleInput.value = rule?.incorrectExample || "";
  els.ruleActiveInput.checked = rule?.active === true;
  updateRuleCounts();
  if (!els.ruleEditorDialog.open) els.ruleEditorDialog.showModal();
  setTimeout(() => els.ruleTitleInput.focus(), 30);
}

function closeRuleEditor() {
  if (els.ruleEditorDialog.open) els.ruleEditorDialog.close();
}

function updateRuleCounts() {
  const pairs = [
    [els.ruleRoleInput, els.ruleRoleCount], [els.ruleContextInput, els.ruleContextCount], [els.ruleMustInput, els.ruleMustCount],
    [els.ruleMustNotInput, els.ruleMustNotCount], [els.ruleShouldInput, els.ruleShouldCount], [els.ruleOutputInput, els.ruleOutputCount],
    [els.ruleCorrectExampleInput, els.ruleCorrectExampleCount], [els.ruleIncorrectExampleInput, els.ruleIncorrectExampleCount]
  ];
  pairs.forEach(([field, count]) => { count.textContent = field.value.length.toLocaleString(); });
}

async function saveRuleFromForm(event) {
  event.preventDefault();
  const now = new Date().toISOString();
  const existing = rules.find((rule) => rule.id === els.editingRuleId.value) || null;
  const candidate = Core.normalizeRule({
    id: existing?.id || crypto.randomUUID(),
    title: els.ruleTitleInput.value,
    role: els.ruleRoleInput.value,
    context: els.ruleContextInput.value,
    must: els.ruleMustInput.value,
    mustNot: els.ruleMustNotInput.value,
    should: els.ruleShouldInput.value,
    outputFormat: els.ruleOutputInput.value,
    correctExample: els.ruleCorrectExampleInput.value,
    incorrectExample: els.ruleIncorrectExampleInput.value,
    active: els.ruleActiveInput.checked,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    versions: existing?.versions || []
  });

  if (!candidate) {
    showToast("Add at least one instruction");
    return;
  }

  candidate.versions = [...(existing?.versions || []), manualVersion(candidate, now)].slice(-50);
  rules = existing
    ? rules.map((rule) => rule.id === existing.id ? candidate : rule)
    : [...rules, candidate];

  await saveRules();
  showToast(existing ? "Rule updated" : "Rule created");
  closeRuleEditor();
}

function manualVersion(rule, savedAt) {
  return {
    id: crypto.randomUUID(),
    savedAt,
    source: "manual",
    title: rule.title,
    role: rule.role,
    context: rule.context,
    must: rule.must,
    mustNot: rule.mustNot,
    should: rule.should,
    outputFormat: rule.outputFormat,
    correctExample: rule.correctExample,
    incorrectExample: rule.incorrectExample,
    active: rule.active
  };
}

async function saveRules() {
  rules = Core.normalizeRules(rules);
  await chrome.storage.local.set({ rules });
  renderRules();
  renderCombineTray();
}

function exportJson() {
  downloadFile(JSON.stringify({ exportedAt: new Date().toISOString(), prompts, rules }, null, 2), "application/json", exportFilename("json"));
  showToast("JSON exported");
}

function exportCsv() {
  const headers = ["created_at", "site", "page_title", "url", "prompt"];
  const rows = prompts.map((prompt) => [prompt.createdAt, prompt.siteName, prompt.pageTitle, prompt.url, prompt.text]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  downloadFile(`\uFEFF${csv}`, "text/csv;charset=utf-8", exportFilename("csv"));
  showToast("CSV exported");
}

function csvCell(value) {
  return `"${String(value || "").replace(/"/g, '""')}"`;
}

function downloadFile(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportFilename(extension) {
  const date = new Date().toISOString().slice(0, 10);
  return `prompt-grabber-${date}.${extension}`;
}


function openPromptPool(sharePromptId = "") {
  const url = new URL(chrome.runtime.getURL("pool.html"));
  if (sharePromptId) url.searchParams.set("share", sharePromptId);
  chrome.tabs.create({ url: url.toString() });
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("app-toast--visible");
  toastTimer = setTimeout(() => els.toast.classList.remove("app-toast--visible"), 1500);
}
