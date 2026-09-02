"use strict";

const Cloud = globalThis.PromptGrabberCloud;
const Core = globalThis.PromptGrabberCore;

const els = Object.fromEntries([
  "backToHistoryButton", "poolSearchInput", "signInButton", "profileButton", "profileAvatar", "profileInitial", "profileName", "profileRole",
  "profileMenu", "signOutButton", "newNicheButton", "nicheList", "sharePromptButton", "cloudSetupBanner", "copyRedirectButton", "authGate",
  "gateSignInButton", "authErrorBox", "authErrorMessage", "copyGateRedirectButton", "copyRedirectHintButton",
  "poolWorkspace", "poolSectionTitle", "poolResultCount", "poolSortSelect", "poolEmpty", "promptGrid", "promptDetailDialog",
  "detailNiche", "detailTitle", "detailSummary", "detailMarkdown", "detailMeta", "detailGrabButton", "closeDetailButton", "publishDialog", "publishForm",
  "closePublishButton", "cancelPublishButton", "publishTitle", "publishNiche", "publishSummary", "publishTags", "publishMarkdown", "publishCount",
  "officialPromptRow", "publishOfficial", "publishStatus", "publishSubmitButton", "nicheDialog", "nicheForm", "closeNicheButton", "nicheName",
  "nicheDescription", "nicheIcon", "poolToast"
].map((id) => [id, document.querySelector(`#${id}`)]));

let session = null;
let profile = null;
let niches = [];
let cloudPrompts = [];
let myVotes = new Map();
let activeNicheId = "all";
let selectedDetailPrompt = null;
let markdownCache = new Map();
let toastTimer = null;
const pendingShareId = new URLSearchParams(location.search).get("share") || "";

initialize().catch((error) => showToast(error?.message || "Unable to open Prompt Pool"));

async function initialize() {
  bindEvents();
  els.cloudSetupBanner.hidden = Cloud.configured();
  if (!Cloud.configured()) {
    els.signInButton.disabled = true;
    els.gateSignInButton.disabled = true;
    els.authGate.hidden = false;
    els.poolWorkspace.hidden = true;
    return;
  }

  session = await Cloud.session();
  if (!session) {
    renderSignedOut();
    return;
  }
  await enterPool();
}

function bindEvents() {
  els.backToHistoryButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
  els.poolSearchInput.addEventListener("input", renderPromptGrid);
  els.poolSortSelect.addEventListener("change", renderPromptGrid);
  els.signInButton.addEventListener("click", signIn);
  els.gateSignInButton.addEventListener("click", signIn);
  els.profileButton.addEventListener("click", () => { els.profileMenu.hidden = !els.profileMenu.hidden; });
  els.signOutButton.addEventListener("click", signOut);
  els.nicheList.addEventListener("click", handleNicheClick);
  document.querySelector('[data-niche-id="all"]').addEventListener("click", () => selectNiche("all"));
  els.promptGrid.addEventListener("click", handlePromptGridAction);
  els.sharePromptButton.addEventListener("click", () => openPublishDialog());
  els.newNicheButton.addEventListener("click", () => els.nicheDialog.showModal());
  els.closeNicheButton.addEventListener("click", () => els.nicheDialog.close());
  els.nicheForm.addEventListener("submit", createNiche);
  els.closeDetailButton.addEventListener("click", () => els.promptDetailDialog.close());
  els.detailGrabButton.addEventListener("click", () => selectedDetailPrompt && grabPrompt(selectedDetailPrompt));
  els.closePublishButton.addEventListener("click", closePublishDialog);
  els.cancelPublishButton.addEventListener("click", closePublishDialog);
  els.publishMarkdown.addEventListener("input", () => { els.publishCount.textContent = els.publishMarkdown.value.length.toLocaleString(); });
  els.publishForm.addEventListener("submit", publishPrompt);

  // Copy OAuth redirect URL — main setup banner button
  els.copyRedirectButton.addEventListener("click", async () => {
    await navigator.clipboard.writeText(Cloud.redirectUrl());
    showToast("OAuth redirect copied");
  });

  // Copy redirect URL from the error box (shown after a redirect-blocked failure)
  els.copyGateRedirectButton?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(Cloud.redirectUrl());
    if (els.copyGateRedirectButton) els.copyGateRedirectButton.textContent = "Copied!";
    setTimeout(() => { if (els.copyGateRedirectButton?.isConnected) els.copyGateRedirectButton.textContent = "Copy my redirect URL"; }, 1500);
    showToast("Redirect URL copied — paste it into Supabase");
  });

  // Proactive hint button before first sign-in attempt
  els.copyRedirectHintButton?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(Cloud.redirectUrl());
    if (els.copyRedirectHintButton) els.copyRedirectHintButton.textContent = "Copied!";
    setTimeout(() => { if (els.copyRedirectHintButton?.isConnected) els.copyRedirectHintButton.textContent = "Copy this machine's redirect URL"; }, 1500);
    showToast("Redirect URL copied");
  });

  document.addEventListener("click", (event) => {
    if (!els.profileMenu.hidden && !event.target.closest(".auth-area")) els.profileMenu.hidden = true;
  });
}

function renderSignedOut() {
  session = null;
  profile = null;
  els.signInButton.hidden = false;
  els.profileButton.hidden = true;
  els.profileMenu.hidden = true;
  els.authGate.hidden = false;
  els.poolWorkspace.hidden = true;
  els.sharePromptButton.hidden = true;
  els.newNicheButton.hidden = true;
}

async function signIn() {
  els.signInButton.disabled = true;
  els.gateSignInButton.disabled = true;
  // Clear any previous redirect error box
  if (els.authErrorBox) els.authErrorBox.hidden = true;
  try {
    session = await Cloud.signInWithGoogle();
    await enterPool();
  } catch (error) {
    const msg = String(error?.message || "Google sign-in failed");
    // Detect redirect-blocked errors and surface the machine's redirect URL
    const isRedirectBlocked = /redirect URL|not allowed|ERR_ABORTED|could not be loaded|not loaded/i.test(msg);
    if (isRedirectBlocked && els.authErrorBox && els.authErrorMessage) {
      // Show the actionable error box inside the auth gate
      els.authErrorMessage.textContent = "Sign-in was blocked because this machine's redirect URL is not in Supabase's allowlist.";
      els.authErrorBox.hidden = false;
      // Also show a brief toast
      showToast("Redirect URL not allowed — copy it below and add it to Supabase");
    } else {
      showToast(msg.split("\n")[0] || "Google sign-in failed");
    }
  } finally {
    els.signInButton.disabled = false;
    els.gateSignInButton.disabled = false;
  }
}

async function signOut() {
  await Cloud.signOut();
  renderSignedOut();
  showToast("Signed out");
}

async function enterPool() {
  els.authGate.hidden = true;
  els.poolWorkspace.hidden = false;
  els.signInButton.hidden = true;
  els.profileButton.hidden = false;

  const health = await Cloud.healthCheck();
  if (!health.ok) throw new Error(health.message || "Cloud connection failed.");

  await loadProfile();
  renderProfile();
  await loadNiches();
  await loadPrompts();
  els.sharePromptButton.hidden = false;
  els.newNicheButton.hidden = profile?.role !== "admin";
  els.officialPromptRow.hidden = profile?.role !== "admin";

  if (pendingShareId) {
    await openPublishDialog(pendingShareId);
    history.replaceState({}, "", chrome.runtime.getURL("pool.html"));
  }
}

async function loadProfile() {
  const userId = session?.user?.id;
  if (!userId) return;
  const rows = await Cloud.rest("profiles", {
    query: { select: "id,display_name,avatar_url,role", id: `eq.${userId}`, limit: 1 }
  });
  profile = Array.isArray(rows) && rows[0] ? rows[0] : {
    id: userId,
    display_name: session.user.user_metadata?.full_name || session.user.email || "User",
    avatar_url: session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture || "",
    role: "member"
  };
}

function renderProfile() {
  const name = profile?.display_name || session?.user?.user_metadata?.full_name || session?.user?.email || "User";
  els.profileName.textContent = name;
  els.profileRole.textContent = profile?.role === "admin" ? "Admin" : "Member";
  els.profileInitial.textContent = name.trim().charAt(0).toUpperCase() || "U";
  const avatar = profile?.avatar_url || session?.user?.user_metadata?.avatar_url || session?.user?.user_metadata?.picture || "";
  if (avatar) {
    els.profileAvatar.src = avatar;
    els.profileAvatar.hidden = false;
    els.profileInitial.hidden = true;
    els.profileAvatar.addEventListener("error", () => {
      els.profileAvatar.hidden = true;
      els.profileInitial.hidden = false;
    }, { once: true });
  } else {
    els.profileAvatar.hidden = true;
    els.profileInitial.hidden = false;
  }
}

async function loadNiches() {
  niches = await Cloud.rest("niches", {
    query: { select: "id,slug,name,description,icon,sort_order", active: "eq.true", order: "sort_order.asc,name.asc" }
  }) || [];
  renderNiches();
  renderPublishNicheOptions();
}

function renderNiches() {
  els.nicheList.replaceChildren(...niches.map((niche) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `niche-item${activeNicheId === niche.id ? " is-active" : ""}`;
    button.dataset.nicheId = niche.id;
    const icon = document.createElement("span");
    icon.className = "niche-icon";
    icon.textContent = niche.icon || niche.name.charAt(0).toUpperCase();
    const copy = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = niche.name;
    const small = document.createElement("small");
    small.textContent = niche.description || "Prompt collection";
    copy.append(strong, small);
    button.append(icon, copy);
    return button;
  }));
  document.querySelector('[data-niche-id="all"]').classList.toggle("is-active", activeNicheId === "all");
}

function handleNicheClick(event) {
  const button = event.target.closest("button[data-niche-id]");
  if (button) selectNiche(button.dataset.nicheId);
}

function selectNiche(id) {
  activeNicheId = id || "all";
  renderNiches();
  renderPromptGrid();
}

async function loadPrompts() {
  cloudPrompts = await Cloud.rest("prompt_pool_feed", {
    query: { select: "*", order: "score.desc,created_at.desc", limit: 250 }
  }) || [];
  await loadMyVotes();
  renderPromptGrid();
}

async function loadMyVotes() {
  myVotes = new Map();
  if (!cloudPrompts.length || !session?.user?.id) return;

  // RLS already limits prompt_votes to the signed-in user's own rows. Avoid a
  // very long `in.(...)` URL when the pool grows; fetch the user's vote rows once
  // and keep only the prompts currently loaded in the client.
  const visibleIds = new Set(cloudPrompts.map((prompt) => prompt.id));
  const rows = await Cloud.rest("prompt_votes", {
    query: {
      select: "prompt_id,value",
      user_id: `eq.${session.user.id}`,
      limit: 1000
    }
  }) || [];
  rows.forEach((row) => {
    if (visibleIds.has(row.prompt_id)) myVotes.set(row.prompt_id, Number(row.value || 0));
  });
}

function visiblePrompts() {
  const query = els.poolSearchInput.value.trim().toLowerCase();
  let result = cloudPrompts.filter((prompt) => {
    if (activeNicheId !== "all" && prompt.niche_id !== activeNicheId) return false;
    if (!query) return true;
    const haystack = [prompt.title, prompt.summary, prompt.niche_name, ...(Array.isArray(prompt.tags) ? prompt.tags : [])]
      .join(" ").toLowerCase();
    return haystack.includes(query);
  });
  const sort = els.poolSortSelect.value;
  result = [...result].sort((a, b) => {
    if (sort === "newest") return Date.parse(b.created_at) - Date.parse(a.created_at);
    if (sort === "grabbed") return Number(b.grab_count || 0) - Number(a.grab_count || 0) || Number(b.score || 0) - Number(a.score || 0);
    return Number(b.score || 0) - Number(a.score || 0) || Number(b.grab_count || 0) - Number(a.grab_count || 0) || Date.parse(b.created_at) - Date.parse(a.created_at);
  });
  return result;
}

function renderPromptGrid() {
  const result = visiblePrompts();
  const activeNiche = niches.find((niche) => niche.id === activeNicheId);
  els.poolSectionTitle.textContent = activeNiche?.name || "All prompts";
  els.poolResultCount.textContent = `${result.length.toLocaleString()} ${result.length === 1 ? "prompt" : "prompts"}`;
  els.poolEmpty.hidden = result.length > 0;
  els.promptGrid.replaceChildren(...result.map(createPoolCard));
}

function createPoolCard(prompt) {
  const card = document.createElement("article");
  card.className = "prompt-pool-card";
  card.dataset.promptId = prompt.id;

  const top = document.createElement("div");
  top.className = "card-topline";
  const chipWrap = document.createElement("div");
  const chip = document.createElement("span");
  chip.className = "prompt-chip";
  chip.textContent = `${prompt.niche_icon || "✦"} ${prompt.niche_name || "Prompt"}`;
  chipWrap.append(chip);
  if (prompt.source === "official") {
    const official = document.createElement("span");
    official.className = "prompt-chip official-chip";
    official.textContent = "Official";
    official.style.marginLeft = "5px";
    chipWrap.append(official);
  }
  const age = document.createElement("span");
  age.className = "card-age";
  age.textContent = formatAge(prompt.created_at);
  top.append(chipWrap, age);

  const title = document.createElement("h3");
  title.textContent = prompt.title;
  const summary = document.createElement("p");
  summary.className = "prompt-pool-card__summary";
  summary.textContent = prompt.summary || "Reusable prompt shared with the Prompt Pool.";

  const tags = document.createElement("div");
  tags.className = "tags";
  (Array.isArray(prompt.tags) ? prompt.tags.slice(0, 5) : []).forEach((value) => {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = value;
    tags.append(tag);
  });

  const bottom = document.createElement("div");
  bottom.className = "card-bottom";
  const vote = document.createElement("div");
  vote.className = "vote-group";
  const userVote = myVotes.get(prompt.id) || 0;
  vote.append(
    voteButton("upvote", "▲", userVote === 1),
    scoreNode(prompt.score),
    voteButton("downvote", "▼", userVote === -1, true)
  );

  const actions = document.createElement("div");
  actions.className = "card-actions";
  const open = document.createElement("button");
  open.type = "button";
  open.className = "card-open";
  open.dataset.action = "open";
  open.textContent = "Open";
  const grab = document.createElement("button");
  grab.type = "button";
  grab.className = "card-grab";
  grab.dataset.action = "grab";
  grab.textContent = "Grab";
  actions.append(open, grab);
  bottom.append(vote, actions);

  const grabs = document.createElement("div");
  grabs.className = "grab-count";
  grabs.textContent = `${Number(prompt.grab_count || 0).toLocaleString()} grabs · by ${prompt.author_name || "Prompt Pool member"}`;

  card.append(top, title, summary, tags, bottom, grabs);
  return card;
}

function voteButton(action, glyph, active, down = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `vote-button${active ? " is-active" : ""}${down ? " is-down" : ""}`;
  button.dataset.action = action;
  button.textContent = glyph;
  button.title = action === "upvote" ? "Upvote" : "Downvote";
  button.setAttribute("aria-label", button.title);
  return button;
}

function scoreNode(value) {
  const score = document.createElement("span");
  score.className = "vote-score";
  score.textContent = Number(value || 0).toLocaleString();
  return score;
}

async function handlePromptGridAction(event) {
  const button = event.target.closest("button[data-action]");
  const card = event.target.closest("[data-prompt-id]");
  if (!button || !card) return;
  const prompt = cloudPrompts.find((item) => item.id === card.dataset.promptId);
  if (!prompt) return;
  if (button.dataset.action === "open") return openPromptDetail(prompt);
  if (button.dataset.action === "grab") return grabPrompt(prompt, button);
  if (button.dataset.action === "upvote") return castVote(prompt, 1, button);
  if (button.dataset.action === "downvote") return castVote(prompt, -1, button);
}

async function castVote(prompt, value, button) {
  button.disabled = true;
  try {
    const result = await Cloud.rpc("cast_prompt_vote", { p_prompt_id: prompt.id, p_value: value });
    const nextScore = Array.isArray(result) ? result[0]?.score : result?.score ?? result;
    const previous = myVotes.get(prompt.id) || 0;
    myVotes.set(prompt.id, previous === value ? 0 : value);
    if (Number.isFinite(Number(nextScore))) prompt.score = Number(nextScore);
    else await loadPrompts();
    renderPromptGrid();
  } catch (error) {
    showToast(error?.message || "Vote failed");
  } finally {
    button.disabled = false;
  }
}

async function getMarkdown(prompt) {
  if (markdownCache.has(prompt.id)) return markdownCache.get(prompt.id);
  const markdown = await Cloud.downloadMarkdown(prompt.markdown_path);
  markdownCache.set(prompt.id, markdown);
  return markdown;
}

async function openPromptDetail(prompt) {
  selectedDetailPrompt = prompt;
  els.detailNiche.textContent = `${prompt.niche_icon || "✦"} ${prompt.niche_name || "Prompt"}`;
  els.detailTitle.textContent = prompt.title;
  els.detailSummary.textContent = prompt.summary || "";
  els.detailMeta.textContent = `${Number(prompt.score || 0).toLocaleString()} score · ${Number(prompt.grab_count || 0).toLocaleString()} grabs · ${prompt.author_name || "Prompt Pool member"}`;
  els.detailMarkdown.textContent = "Loading Markdown…";
  if (!els.promptDetailDialog.open) els.promptDetailDialog.showModal();
  try {
    els.detailMarkdown.textContent = await getMarkdown(prompt);
  } catch (error) {
    els.detailMarkdown.textContent = error?.message || "Unable to load prompt.";
  }
}

async function grabPrompt(prompt, button = null) {
  if (button) {
    button.disabled = true;
    button.textContent = "Grabbing…";
  }
  try {
    const markdown = await getMarkdown(prompt);
    const stored = await chrome.storage.local.get(["prompts", "combineSelection", "settings"]);
    const localPrompts = Array.isArray(stored.prompts) ? stored.prompts : [];
    let selection = Array.isArray(stored.combineSelection) ? stored.combineSelection.filter((id) => typeof id === "string") : [];
    let local = localPrompts.find((item) => item.cloudPromptId === prompt.id);
    if (!local) {
      local = {
        id: crypto.randomUUID(),
        text: markdown,
        siteId: "prompt-pool",
        siteName: "Prompt Pool",
        url: "",
        pageTitle: prompt.title,
        captureMethod: "cloud-pool",
        cloudPromptId: prompt.id,
        cloudMarkdownPath: prompt.markdown_path,
        cloudNiche: prompt.niche_name || "",
        createdAt: new Date().toISOString()
      };
      localPrompts.unshift(local);
      const maxPrompts = Core.mergeSettings(stored.settings).maxPrompts;
      if (localPrompts.length > maxPrompts) localPrompts.length = maxPrompts;
    }
    selection = selection.filter((id) => localPrompts.some((item) => item.id === id));
    if (!selection.includes(local.id)) selection.push(local.id);
    await chrome.storage.local.set({ prompts: localPrompts, combineSelection: selection });
    try {
      const result = await Cloud.rpc("increment_prompt_grab", { p_prompt_id: prompt.id });
      const count = Array.isArray(result) ? result[0]?.grab_count : result?.grab_count ?? result;
      if (Number.isFinite(Number(count))) prompt.grab_count = Number(count);
    } catch (_error) { /* local grab must still succeed */ }
    renderPromptGrid();
    showToast("Grabbed to your local selection");
    if (els.promptDetailDialog.open) els.promptDetailDialog.close();
  } catch (error) {
    showToast(error?.message || "Unable to grab prompt");
  } finally {
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = "Grab";
    }
  }
}

function renderPublishNicheOptions() {
  const current = els.publishNiche.value;
  els.publishNiche.replaceChildren(...niches.map((niche) => {
    const option = document.createElement("option");
    option.value = niche.id;
    option.textContent = `${niche.icon || "✦"} ${niche.name}`;
    return option;
  }));
  if (niches.some((niche) => niche.id === current)) els.publishNiche.value = current;
}

async function openPublishDialog(localPromptId = "") {
  if (!session) return signIn();
  if (!niches.length) return showToast("Create a niche before publishing prompts");

  els.publishForm.reset();
  els.publishStatus.textContent = "Stored as Markdown in Supabase Storage.";
  els.publishSubmitButton.disabled = false;
  els.publishSubmitButton.textContent = "Publish";
  els.publishOfficial.checked = false;
  els.officialPromptRow.hidden = profile?.role !== "admin";
  renderPublishNicheOptions();

  if (localPromptId) {
    const stored = await chrome.storage.local.get("prompts");
    const prompt = (Array.isArray(stored.prompts) ? stored.prompts : []).find((item) => item.id === localPromptId);
    if (!prompt) return showToast("Local prompt not found");
    els.publishMarkdown.value = prompt.text || "";
    els.publishTitle.value = suggestTitle(prompt.text);
    const matching = niches.find((niche) => String(prompt.pageTitle || "").toLowerCase().includes(niche.name.toLowerCase()));
    if (matching) els.publishNiche.value = matching.id;
  }
  els.publishCount.textContent = els.publishMarkdown.value.length.toLocaleString();
  if (!els.publishDialog.open) els.publishDialog.showModal();
  requestAnimationFrame(() => (els.publishTitle.value ? els.publishSummary : els.publishTitle).focus());
}

function closePublishDialog() {
  if (els.publishDialog.open) els.publishDialog.close();
}

function suggestTitle(text) {
  const clean = String(text || "").replace(/[#>*_`]/g, "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.slice(0, 90).replace(/[.,;:!?\s]+$/, "");
}

async function publishPrompt(event) {
  event.preventDefault();
  const title = els.publishTitle.value.trim();
  const markdown = els.publishMarkdown.value.trim();
  const niche = niches.find((item) => item.id === els.publishNiche.value);
  if (!title || !markdown || !niche) return;

  const promptId = crypto.randomUUID();
  const objectPath = `${niche.slug}/${session.user.id}/${promptId}.md`;
  const tags = [...new Set(els.publishTags.value.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 12);
  const summary = els.publishSummary.value.trim() || markdown.replace(/[#>*_`\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 220);
  const source = profile?.role === "admin" && els.publishOfficial.checked ? "official" : "community";
  const contentHash = await sha256(markdown);

  els.publishSubmitButton.disabled = true;
  els.publishSubmitButton.textContent = "Publishing…";
  els.publishStatus.textContent = "Uploading Markdown…";
  try {
    await Cloud.uploadMarkdown(objectPath, markdown, { upsert: false });
    els.publishStatus.textContent = "Saving Prompt Pool metadata…";
    try {
      await Cloud.rpc("publish_prompt", {
        p_id: promptId,
        p_title: title,
        p_summary: summary,
        p_tags: tags,
        p_niche_id: niche.id,
        p_markdown_path: objectPath,
        p_content_hash: contentHash,
        p_source: source
      });
    } catch (error) {
      await Cloud.deleteMarkdown(objectPath);
      throw error;
    }
    markdownCache.set(promptId, markdown);
    closePublishDialog();
    await loadPrompts();
    showToast("Prompt published to the cloud pool");
  } catch (error) {
    els.publishStatus.textContent = error?.message || "Publish failed";
    showToast(error?.message || "Publish failed");
  } finally {
    els.publishSubmitButton.disabled = false;
    els.publishSubmitButton.textContent = "Publish";
  }
}

async function createNiche(event) {
  event.preventDefault();
  if (profile?.role !== "admin") return showToast("Only an admin can add niches");
  const name = els.nicheName.value.trim();
  if (!name) return;
  const slug = slugify(name);
  try {
    await Cloud.rest("niches", {
      method: "POST",
      body: {
        name,
        slug,
        description: els.nicheDescription.value.trim(),
        icon: els.nicheIcon.value.trim() || "✦",
        created_by: session.user.id,
        active: true,
        sort_order: niches.length * 10 + 10
      },
      prefer: "return=representation"
    });
    els.nicheForm.reset();
    els.nicheDialog.close();
    await loadNiches();
    showToast("Niche created");
  } catch (error) {
    showToast(error?.message || "Unable to create niche");
  }
}

function slugify(value) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || `niche-${Date.now()}`;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function formatAge(value) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "";
  const elapsed = Date.now() - time;
  if (elapsed < 60_000) return "now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}d`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(time));
}

function showToast(message) {
  clearTimeout(toastTimer);
  els.poolToast.textContent = String(message || "");
  els.poolToast.classList.add("is-visible");
  toastTimer = setTimeout(() => els.poolToast.classList.remove("is-visible"), 1900);
}
