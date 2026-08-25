(function initPromptGrabberCore(global) {
  "use strict";

  const GENERIC_EDITORS = [
    "textarea",
    "div[contenteditable='true'][role='textbox']",
    "div[contenteditable='true'].ProseMirror",
    "div[contenteditable='true'][data-lexical-editor='true']",
    "div[contenteditable='true']",
    "input[type='text']"
  ];

  const GENERIC_SEND_BUTTONS = [
    "button[type='submit']",
    "button[data-testid*='send' i]",
    "button[aria-label*='send' i]",
    "button[aria-label*='submit' i]",
    "button[title*='send' i]"
  ];

  // Used only by the manual “Grab now” chat scan. These selectors intentionally
  // target user-authored message containers, never assistant response containers.
  const GENERIC_USER_MESSAGES = [
    "[data-message-author-role='user']",
    "[data-author='user']",
    "[data-role='user']",
    "[data-message-role='user']",
    "[data-testid*='user-message' i]",
    "[data-testid*='user-query' i]",
    "[class*='user-message' i]",
    "[class*='user-query' i]"
  ];

  const SITES = [
    { id: "chatgpt", name: "ChatGPT", hosts: ["chatgpt.com", "chat.openai.com"], editors: ["#prompt-textarea", "textarea[data-id='root']", "div#prompt-textarea[contenteditable='true']"], sendButtons: ["button[data-testid='send-button']", "button[aria-label*='Send prompt' i]"], userMessages: ["[data-message-author-role='user']"] },
    { id: "claude", name: "Claude", hosts: ["claude.ai", "claude.com"], editors: ["div[contenteditable='true'].ProseMirror", "div[data-testid*='composer' i] div[contenteditable='true']"], sendButtons: ["button[aria-label*='Send message' i]", "button[data-testid*='send' i]"], userMessages: ["[data-testid='user-message']", "[data-testid*='user-message' i]"] },
    { id: "gemini", name: "Gemini", hosts: ["gemini.google.com", "bard.google.com"], editors: ["rich-textarea div[contenteditable='true']", ".ql-editor[contenteditable='true']"], sendButtons: ["button[aria-label*='Send message' i]", "button.send-button"], userMessages: ["user-query", ".user-query-container", "[data-testid*='user-query' i]"] },
    { id: "grok", name: "Grok", hosts: ["grok.com"], editors: ["textarea[placeholder]", "div[contenteditable='true'][role='textbox']"], sendButtons: ["button[aria-label*='Submit' i]", "button[aria-label*='Send' i]"], userMessages: ["[data-message-author-role='user']", "[data-testid*='user-message' i]"] },
    { id: "grok", name: "Grok", hosts: ["x.com"], pathPrefix: "/i/grok", editors: ["textarea", "div[contenteditable='true'][role='textbox']"], sendButtons: ["button[aria-label*='Submit' i]", "button[aria-label*='Send' i]"], userMessages: ["[data-message-author-role='user']", "[data-testid*='user-message' i]"] },
    { id: "perplexity", name: "Perplexity", hosts: ["perplexity.ai", "www.perplexity.ai"], editors: ["textarea[placeholder]", "div[contenteditable='true'][role='textbox']"], sendButtons: ["button[aria-label*='Submit' i]", "button[aria-label*='Send' i]"], userMessages: ["[data-testid*='user-query' i]", "[data-testid*='user-message' i]"] },
    { id: "kimi", name: "Kimi", hosts: ["kimi.com", "www.kimi.com", "kimi.moonshot.cn"], editors: ["div[contenteditable='true']", "textarea"], sendButtons: ["button[aria-label*='Send' i]", "button[class*='send' i]"], userMessages: ["[data-role='user']", "[data-testid*='user-message' i]"] },
    { id: "deepseek", name: "DeepSeek", hosts: ["chat.deepseek.com", "www.deepseek.com"], editors: ["textarea[placeholder]", "div[contenteditable='true']"], sendButtons: ["button[aria-label*='Send' i]", "div[role='button'][aria-label*='Send' i]"], userMessages: ["[data-role='user']", "[data-message-author-role='user']", "[data-testid*='user-message' i]"] },
    { id: "moonshot", name: "Moonshot AI", hosts: ["moonshot.ai", "www.moonshot.ai"], editors: ["textarea", "div[contenteditable='true'][role='textbox']"], sendButtons: ["button[aria-label*='Send' i]", "button[type='submit']"], userMessages: ["[data-role='user']", "[data-testid*='user-message' i]"] },
    { id: "thinker", name: "Thinker", hosts: ["thinker.ai", "www.thinker.ai", "chat.thinker.ai"], editors: ["textarea", "div[contenteditable='true'][role='textbox']"], sendButtons: ["button[aria-label*='Send' i]", "button[type='submit']"], userMessages: ["[data-role='user']", "[data-testid*='user-message' i]"] }
  ];

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    captureOnEnter: true,
    captureUrl: true,
    showActivationToast: true,
    maxPrompts: 2000,
    blockedSites: [],
    customOrigins: []
  });

  function normalizeRule(rule) {
    if (!rule || typeof rule !== "object") return null;

    const title = String(rule.title || "Untitled rule").trim().slice(0, 160) || "Untitled rule";
    const role = String(rule.role || "").trim().slice(0, 2500);
    const context = String(rule.context || "").trim().slice(0, 5000);
    const must = String(rule.must || "").trim().slice(0, 5000);
    const mustNot = String(rule.mustNot || "").trim().slice(0, 5000);
    const should = String(rule.should || "").trim().slice(0, 5000);
    // v1.2 migration: keep existing Output expectations as Output format.
    const outputFormat = String(rule.outputFormat || rule.outputExpectations || rule.text || "").trim().slice(0, 5000);
    const correctExample = String(rule.correctExample || "").trim().slice(0, 5000);
    const incorrectExample = String(rule.incorrectExample || "").trim().slice(0, 5000);

    if (![role, context, must, mustNot, should, outputFormat, correctExample, incorrectExample].some(Boolean)) return null;

    const createdAt = validIsoDate(rule.createdAt) || new Date().toISOString();
    const updatedAt = validIsoDate(rule.updatedAt) || createdAt;
    const versions = Array.isArray(rule.versions) ? rule.versions.slice(-50) : [];

    return {
      id: String(rule.id || ""),
      title,
      role,
      context,
      must,
      mustNot,
      should,
      outputFormat,
      correctExample,
      incorrectExample,
      // A rule is used by Compile only when the user explicitly toggles it on.
      active: rule.active === true,
      createdAt,
      updatedAt,
      versions
    };
  }

  function normalizeRules(rules) {
    return (Array.isArray(rules) ? rules : []).map(normalizeRule).filter(Boolean);
  }

  function activeRulesInOrder(rules) {
    return normalizeRules(rules)
      .filter((rule) => rule.active)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.title.localeCompare(b.title));
  }

  function rawPromptText(selectedPrompts) {
    return (Array.isArray(selectedPrompts) ? selectedPrompts : [])
      .map((prompt) => String(prompt?.text || ""))
      .filter((text) => text.length > 0);
  }

  function buildRawCombinedPrompt(selectedPrompts) {
    // Combine is intentionally lossless: prompt text is never rewritten.
    return rawPromptText(selectedPrompts).join("\n\n");
  }

  function bulletLines(value, prefix) {
    return String(value || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `- ${prefix} ${line.replace(/^[-*]\s*/, "")}`);
  }

  function buildRuleMarkdown(rule) {
    const sections = [`# Rule: ${rule.title}`];

    const roleContext = [];
    if (rule.role) roleContext.push(`Role: ${rule.role}`);
    if (rule.context) roleContext.push(`Context / Goal: ${rule.context}`);
    if (roleContext.length) sections.push(`# Role and Context\n${roleContext.join("\n\n")}`);

    const constraints = [
      ...bulletLines(rule.must, "MUST"),
      ...bulletLines(rule.mustNot, "MUST NOT"),
      ...bulletLines(rule.should, "SHOULD")
    ];
    if (constraints.length) sections.push(`# Core Constraints\n${constraints.join("\n")}`);

    if (rule.outputFormat) sections.push(`# Output Format\n${rule.outputFormat}`);

    const examples = [];
    if (rule.correctExample) examples.push(`## Correct Style:\n${rule.correctExample}`);
    if (rule.incorrectExample) examples.push(`## Incorrect Style:\n${rule.incorrectExample}`);
    if (examples.length) sections.push(`# Examples\n${examples.join("\n\n")}`);

    return sections.join("\n\n");
  }

  function buildRuleBookMarkdown(rules) {
    return activeRulesInOrder(rules).map(buildRuleMarkdown).join("\n\n---\n\n");
  }

  function buildCompilerRequest(selectedPrompts, rules) {
    const promptText = buildRawCombinedPrompt(selectedPrompts);
    const ruleBook = buildRuleBookMarkdown(rules);
    if (!promptText) return "";

    const sections = [];
    if (ruleBook) sections.push("ACTIVE RULE BOOK\n\n" + ruleBook);
    sections.push("SOURCE PROMPTS\n\n" + promptText);
    return sections.join("\n\n==============================\n\n");
  }

  // Static helper retained for exports/backward compatibility. The UI's Compile action
  // uses the on-device LanguageModel and returns AI-rewritten text instead.
  function buildCompiledPrompt(selectedPrompts, rules) {
    const promptText = buildRawCombinedPrompt(selectedPrompts);
    const ruleBook = buildRuleBookMarkdown(rules);
    if (!promptText) return "";
    return ruleBook ? `${ruleBook}\n\n==============================\n\n${promptText}` : promptText;
  }

  function buildCombinedPrompt(selectedPrompts, rules) {
    return buildCompiledPrompt(selectedPrompts, rules);
  }

  function validIsoDate(value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
  }

  function normalizeHostname(hostname) {
    return String(hostname || "").trim().toLowerCase().replace(/\.$/, "");
  }

  function detectSite(hostname, pathname) {
    const host = normalizeHostname(hostname);
    const path = String(pathname || "/");
    return SITES.find((site) => {
      const hostMatches = site.hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
      return hostMatches && (!site.pathPrefix || path.startsWith(site.pathPrefix));
    }) || null;
  }

  function cleanPromptText(value) {
    return String(value || "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\u00A0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();
  }

  function normalizeOrigin(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      return url.origin;
    } catch (_error) {
      return null;
    }
  }

  function originToMatchPattern(origin) {
    const normalized = normalizeOrigin(origin);
    return normalized ? `${normalized}/*` : null;
  }

  function stripUrl(url, keepUrl) {
    if (!keepUrl) return "";
    try {
      const parsed = new URL(url);
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    } catch (_error) {
      return "";
    }
  }

  function mergeSettings(settings) {
    const merged = { ...DEFAULT_SETTINGS, ...(settings || {}) };
    merged.blockedSites = Array.isArray(merged.blockedSites) ? [...new Set(merged.blockedSites)] : [];
    merged.customOrigins = Array.isArray(merged.customOrigins)
      ? [...new Set(merged.customOrigins.map(normalizeOrigin).filter(Boolean))]
      : [];
    merged.maxPrompts = Math.min(5000, Math.max(100, Number(merged.maxPrompts) || DEFAULT_SETTINGS.maxPrompts));
    return merged;
  }

  function siteEditors(site) {
    return [...new Set([...(site?.editors || []), ...GENERIC_EDITORS])];
  }

  function siteSendButtons(site) {
    return [...new Set([...(site?.sendButtons || []), ...GENERIC_SEND_BUTTONS])];
  }

  function siteUserMessages(site) {
    const specific = Array.isArray(site?.userMessages) ? site.userMessages : [];
    return specific.length ? [...new Set(specific)] : [...GENERIC_USER_MESSAGES];
  }

  global.PromptGrabberCore = Object.freeze({
    DEFAULT_SETTINGS,
    GENERIC_EDITORS,
    GENERIC_SEND_BUTTONS,
    GENERIC_USER_MESSAGES,
    SITES,
    activeRulesInOrder,
    activeRulesInPriorityOrder: activeRulesInOrder,
    buildRawCombinedPrompt,
    buildRuleBookMarkdown,
    buildCompilerRequest,
    buildCompiledPrompt,
    buildCombinedPrompt,
    cleanPromptText,
    detectSite,
    mergeSettings,
    normalizeRule,
    normalizeRules,
    normalizeHostname,
    normalizeOrigin,
    originToMatchPattern,
    siteEditors,
    siteSendButtons,
    siteUserMessages,
    stripUrl
  });
})(globalThis);
