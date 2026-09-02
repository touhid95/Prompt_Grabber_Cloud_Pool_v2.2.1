(function startPromptGrabber() {
  "use strict";

  if (window.top !== window || window.__promptGrabberLoaded) return;
  window.__promptGrabberLoaded = true;

  const Core = globalThis.PromptGrabberCore;
  if (!Core) return;

  const state = {
    active: false,
    settings: Core.mergeSettings(),
    site: null,
    lastText: "",
    lastCaptureAt: 0
  };

  const labelRejectPattern = /\b(search|find|filter|title|name|email|username|password|login|sign in)\b/i;
  const labelPreferPattern = /\b(prompt|message|ask|chat|question|reply|anything|type)\b/i;

  async function initialize() {
    const stored = await chrome.storage.local.get("settings");
    state.settings = Core.mergeSettings(stored.settings);
    const builtIn = Core.detectSite(location.hostname, location.pathname);
    const isCustom = state.settings.customOrigins.includes(location.origin);

    if (!builtIn && !isCustom) return;

    state.site = builtIn || {
      id: `custom:${location.hostname}`,
      name: readableSiteName(),
      editors: Core.GENERIC_EDITORS,
      sendButtons: Core.GENERIC_SEND_BUTTONS
    };

    if (!state.settings.enabled || isBlocked()) return;

    state.active = true;
    document.documentElement.dataset.promptGrabber = "active";
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    chrome.runtime.onMessage.addListener(onRuntimeMessage);

    if (state.settings.showActivationToast) showActivationToast();
  }

  function readableSiteName() {
    const first = location.hostname.replace(/^www\./, "").split(".")[0] || "Custom AI";
    return first.charAt(0).toUpperCase() + first.slice(1);
  }

  function isBlocked() {
    return state.settings.blockedSites.includes(state.site.id) || state.settings.blockedSites.includes(location.origin);
  }

  function onSubmit(event) {
    capturePrompt("form-submit", event.target);
  }

  function onKeyDown(event) {
    if (!state.settings.captureOnEnter || event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    if (event.defaultPrevented && !event.ctrlKey && !event.metaKey) return;
    const editor = closestEditor(event.target);
    if (!editor) return;
    capturePrompt("enter-key", editor);
  }

  function onPointerDown(event) {
    const button = closestSendButton(event.target);
    if (!button || button.disabled || button.getAttribute("aria-disabled") === "true") return;
    capturePrompt("send-button", button);
  }

  function closestEditor(target) {
    if (!(target instanceof Element)) return null;
    const selector = Core.siteEditors(state.site).join(",");
    try {
      return target.matches(selector) ? target : target.closest(selector);
    } catch (_error) {
      return null;
    }
  }

  function closestSendButton(target) {
    if (!(target instanceof Element)) return null;
    const selector = Core.siteSendButtons(state.site).join(",");
    try {
      const candidate = target.closest(selector);
      if (!candidate) return null;
      const label = elementLabel(candidate);
      if (candidate.matches("button[type='submit']") && labelRejectPattern.test(label)) return null;
      return candidate;
    } catch (_error) {
      return null;
    }
  }

  function capturePrompt(reason, source) {
    if (!state.active) return;
    const editor = findBestEditor(source);
    if (!editor) return;

    const text = Core.cleanPromptText(readEditorText(editor));
    if (!text || text.length > 100000) return;

    const now = Date.now();
    if (text === state.lastText && now - state.lastCaptureAt < 8000) return;
    state.lastText = text;
    state.lastCaptureAt = now;

    if (!chrome?.runtime?.id) {
      state.active = false;
      return;
    }

    chrome.runtime.sendMessage({
      type: "CAPTURE_PROMPT",
      payload: {
        text,
        reason,
        siteId: state.site.id,
        siteName: state.site.name,
        pageTitle: document.title,
        url: location.href
      }
    }).catch(() => undefined);
  }


  function captureChatPrompts() {
    if (!state.active) return Promise.resolve({ ok: false, reason: "inactive", found: 0, saved: 0 });

    const promptTexts = extractChatUserPrompts();
    if (!promptTexts.length) {
      return Promise.resolve({ ok: false, reason: "no-prompts", found: 0, saved: 0 });
    }

    if (!chrome?.runtime?.id) {
      state.active = false;
      return Promise.resolve({ ok: false, reason: "context-invalidated", found: promptTexts.length, saved: 0 });
    }

    return chrome.runtime.sendMessage({
      type: "CAPTURE_PROMPT_BATCH",
      payload: {
        prompts: promptTexts,
        reason: "chat-scan",
        siteId: state.site.id,
        siteName: state.site.name,
        pageTitle: document.title,
        url: location.href
      }
    }).then((result) => ({
      ok: Boolean(result?.ok),
      found: promptTexts.length,
      saved: Number(result?.saved || 0),
      skipped: Number(result?.skipped || 0),
      reason: result?.reason || ""
    }));
  }

  function extractChatUserPrompts() {
    const siteSelectors = Core.siteUserMessages(state.site);
    let candidates = queryMessageCandidates(siteSelectors);

    // Custom or newly changed sites can still work when they expose semantic user markers.
    if (!candidates.length && siteSelectors !== Core.GENERIC_USER_MESSAGES) {
      candidates = queryMessageCandidates(Core.GENERIC_USER_MESSAGES);
    }

    return collapseNestedMessageCandidates(candidates)
      .map(readUserMessageText)
      .map((text) => Core.cleanPromptText(text))
      .filter((text) => text && text.length <= 100000);
  }

  function queryMessageCandidates(selectors) {
    const output = new Set();
    for (const selector of selectors || []) {
      try {
        document.querySelectorAll(selector).forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          if (element.closest("[data-prompt-grabber-ui]")) return;
          if (isComposerElement(element)) return;
          output.add(element);
        });
      } catch (_error) {
        // A stale site-specific selector must not break the remaining fallbacks.
      }
    }

    return [...output].sort((a, b) => {
      if (a === b) return 0;
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }

  function collapseNestedMessageCandidates(candidates) {
    return candidates.filter((candidate) => !candidates.some((other) => {
      if (other === candidate || !candidate.contains(other)) return false;
      // If both selectors found the same message at different nesting levels, keep
      // the more specific inner node to avoid labels/toolbars from the wrapper.
      const outerText = Core.cleanPromptText(readUserMessageText(candidate));
      const innerText = Core.cleanPromptText(readUserMessageText(other));
      return innerText && (outerText === innerText || outerText.includes(innerText));
    }));
  }

  function isComposerElement(element) {
    const selectors = Core.siteEditors(state.site);
    return selectors.some((selector) => {
      try {
        return element.matches(selector) || Boolean(element.querySelector(selector));
      } catch (_error) {
        return false;
      }
    });
  }

  function readUserMessageText(element) {
    // ChatGPT and several other clients place the actual message in a nested
    // pre-wrapped content node. Prefer it when available to avoid surrounding UI.
    const focused = element.querySelector(
      "[data-message-content], .whitespace-pre-wrap, [class*='message-content' i], [class*='query-text' i]"
    );
    const source = focused instanceof HTMLElement ? focused : element;
    const clone = source.cloneNode(true);

    clone.querySelectorAll([
      "button", "input", "textarea", "select", "option", "svg", "script", "style",
      "[role='button']", "[contenteditable='true']", "[aria-hidden='true']",
      "[class*='sr-only' i]", "[class*='visually-hidden' i]", "[data-prompt-grabber-ui]"
    ].join(",")).forEach((node) => node.remove());

    return String(clone.innerText || clone.textContent || "")
      .replace(/^\s*(?:you said|user)\s*:\s*/i, "")
      .trim();
  }

  function findBestEditor(source) {
    const sourceElement = source instanceof Element ? source : null;
    const form = sourceElement?.closest("form");
    const selectors = Core.siteEditors(state.site);
    const candidates = new Set();

    if (sourceElement) {
      const direct = closestEditor(sourceElement);
      if (direct) candidates.add(direct);
    }

    if (form) addMatches(form, selectors, candidates);
    addMatches(document, selectors, candidates);

    return [...candidates]
      .filter(isValidEditor)
      .map((element) => ({ element, score: scoreEditor(element, form) }))
      .sort((a, b) => b.score - a.score)[0]?.element || null;
  }

  function addMatches(root, selectors, output) {
    for (const selector of selectors) {
      try {
        root.querySelectorAll(selector).forEach((element) => output.add(element));
      } catch (_error) {
        // A future site selector should not disable generic capture.
      }
    }
  }

  function isValidEditor(element) {
    if (!(element instanceof HTMLElement) || !isVisible(element)) return false;
    if (element.closest("[data-prompt-grabber-ui]")) return false;
    if (element instanceof HTMLInputElement && element.type !== "text") return false;
    const label = elementLabel(element);
    if (labelRejectPattern.test(label) && !labelPreferPattern.test(label)) return false;
    return Boolean(Core.cleanPromptText(readEditorText(element)));
  }

  function isVisible(element) {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function scoreEditor(element, form) {
    let score = 0;
    const rect = element.getBoundingClientRect();
    const label = elementLabel(element);
    const siteSpecific = (state.site.editors || []).some((selector) => {
      try { return element.matches(selector); } catch (_error) { return false; }
    });

    if (siteSpecific) score += 100;
    if (form && element.closest("form") === form) score += 50;
    if (element === document.activeElement) score += 40;
    if (labelPreferPattern.test(label)) score += 25;
    if (labelRejectPattern.test(label)) score -= 100;
    if (rect.top > window.innerHeight * 0.45) score += 15;
    if (element instanceof HTMLTextAreaElement || element.isContentEditable) score += 10;
    score += Math.min(Core.cleanPromptText(readEditorText(element)).length / 1000, 5);
    return score;
  }

  function elementLabel(element) {
    return [
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      element.getAttribute("data-placeholder"),
      element.getAttribute("title"),
      element.getAttribute("name"),
      element.id
    ].filter(Boolean).join(" ");
  }

  function readEditorText(element) {
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return element.value;
    return element.innerText || element.textContent || "";
  }

  function showActivationToast() {
    const display = () => {
      if (!document.body || document.querySelector("[data-prompt-grabber-ui='toast']")) return;
      const toast = document.createElement("div");
      toast.dataset.promptGrabberUi = "toast";
      toast.className = "prompt-grabber-toast";
      toast.textContent = `Prompt Grabber active on ${state.site.name}`;
      document.body.appendChild(toast);
      requestAnimationFrame(() => toast.classList.add("prompt-grabber-toast--visible"));
      setTimeout(() => {
        toast.classList.remove("prompt-grabber-toast--visible");
        setTimeout(() => toast.remove(), 250);
      }, 1800);
    };

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", display, { once: true });
    else display();
  }

  function onRuntimeMessage(message, _sender, sendResponse) {
    if (message?.type === "PROMPT_GRABBER_STATUS") {
      sendResponse({ active: state.active, site: state.site?.name || null, siteId: state.site?.id || null });
      return false;
    }
    if (message?.type === "CAPTURE_CHAT_PROMPTS") {
      captureChatPrompts().then(sendResponse).catch((error) => sendResponse({
        ok: false,
        reason: "capture-failed",
        error: error?.message || String(error),
        found: 0,
        saved: 0
      }));
      return true;
    }
    // Kept for backward compatibility with older popup builds.
    if (message?.type === "CAPTURE_ACTIVE_EDITOR") {
      capturePrompt("manual", document.activeElement);
      sendResponse({ ok: true });
      return false;
    }
    return false;
  }

  initialize().catch(() => undefined);
})();
