(function initPromptGrabberCloudConfig(global) {
  "use strict";

  // Replace these two values before using the cloud Prompt Pool.
  // Use your Supabase project URL and the public/publishable (anon) key only.
  // NEVER place a service_role key inside a browser extension.
  global.PromptGrabberCloudConfig = Object.freeze({
    supabaseUrl: "https://ohcxpncivnbcelhdbuug.supabase.co",
    publishableKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9oY3hwbmNpdm5iY2VsaGRidXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NDE0MDksImV4cCI6MjEwMzIxNzQwOX0.f8EW2KSFf7sH6xqnBO-i9egzsMtXnJPZxkHXu374tzU",
    markdownBucket: "prompt-markdown"
  });
})(globalThis);
