(function initPromptGrabberAI(global) {
  "use strict";

  const Core = global.PromptGrabberCore;
  const SYSTEM_INSTRUCTION = [
    "You are a prompt compiler.",
    "Transform the supplied source prompts into ONE cohesive prompt for another AI model.",
    "Do not answer, solve, or execute the source prompts.",
    "Apply every active Rule Book instruction that is supplied.",
    "Preserve all concrete facts, names, numbers, requirements, examples, constraints, and user intent from the source prompts.",
    "You may remove duplicate wording, reorganize content, and clarify phrasing when doing so does not change meaning.",
    "Do not invent facts, requirements, policies, or missing details.",
    "If active rules conflict, the later rule in the supplied Rule Book takes precedence.",
    "Return only the final compiled prompt. Do not add commentary, headings about your work, or markdown fences unless the Rule Book explicitly requests them."
  ].join(" ");

  function apiAvailable() {
    return Boolean(global.LanguageModel && typeof global.LanguageModel.availability === "function" && typeof global.LanguageModel.create === "function");
  }

  async function availability() {
    if (!apiAvailable()) return "unsupported";
    try {
      return await global.LanguageModel.availability();
    } catch (_error) {
      return "unavailable";
    }
  }

  function error(message, code) {
    const value = new Error(message);
    value.code = code;
    return value;
  }

  async function compile(selectedPrompts, rules, hooks = {}) {
    if (!Core) throw error("Prompt compiler is not initialized.", "CORE_UNAVAILABLE");
    const request = Core.buildCompilerRequest(selectedPrompts, rules);
    if (!request) throw error("Select at least one prompt.", "EMPTY_INPUT");
    if (!apiAvailable()) throw error("Chrome on-device AI is not available on this browser or device.", "AI_UNSUPPORTED");

    const state = await availability();
    hooks.onStatus?.(state === "available" ? "Starting on-device AI…" : "Preparing on-device AI…");
    if (state === "unavailable" || state === "unsupported") {
      throw error("Chrome on-device AI is unavailable on this device.", "AI_UNAVAILABLE");
    }

    let session;
    try {
      session = await global.LanguageModel.create({
        initialPrompts: [{ role: "system", content: SYSTEM_INSTRUCTION }],
        monitor(monitor) {
          monitor.addEventListener("downloadprogress", (event) => {
            const progress = Math.max(0, Math.min(1, Number(event.loaded) || 0));
            hooks.onProgress?.(progress);
            hooks.onStatus?.(`Downloading on-device AI · ${Math.round(progress * 100)}%`);
          });
        }
      });

      hooks.onStatus?.("Compiling with on-device AI…");
      const result = await session.prompt(request);
      const text = String(result || "").trim();
      if (!text) throw error("The on-device model returned an empty result.", "EMPTY_RESULT");
      hooks.onStatus?.("Compiled on device");
      return text;
    } catch (cause) {
      if (cause?.code) throw cause;
      if (cause?.name === "QuotaExceededError") {
        throw error("The selected prompts are too large for the on-device model context window.", "CONTEXT_LIMIT");
      }
      if (cause?.name === "NotSupportedError") {
        throw error("This prompt or language is not supported by the current on-device model.", "NOT_SUPPORTED");
      }
      if (cause?.name === "AbortError") throw error("Compilation was cancelled.", "ABORTED");
      throw error(cause?.message || "On-device compilation failed.", "AI_FAILED");
    } finally {
      try { session?.destroy(); } catch (_error) { /* best effort */ }
    }
  }

  global.PromptGrabberAI = Object.freeze({ apiAvailable, availability, compile });
})(globalThis);
