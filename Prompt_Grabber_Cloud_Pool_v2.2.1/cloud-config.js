(function initPromptGrabberCloudConfig(global) {
  "use strict";

  // Replace these two values before using the cloud Prompt Pool.
  // Use your Supabase project URL and the public/publishable (anon) key only.
  // NEVER place a service_role key inside a browser extension.
  global.PromptGrabberCloudConfig = Object.freeze({
    supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
    publishableKey: "YOUR_SUPABASE_PUBLISHABLE_KEY",
    markdownBucket: "prompt-markdown"
  });
})(globalThis);
