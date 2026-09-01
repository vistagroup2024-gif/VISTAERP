// Model and runtime settings for Vista AI.
//
// The key lives server-side only. It is read here and nowhere else, and it is
// never returned to the browser — the settings screen shows "connected" or
// "not configured", never the value.

export const AI_MODEL = "claude-opus-5";

// The assistant answers ERP lookups in a spoken conversation, so latency is
// part of the product. Adaptive thinking at low effort keeps tool selection
// sound while staying quick; a long analytical answer is not what "how much
// does ABC Travel owe" wants.
export const AI_EFFORT = "low" as const;

export const AI_MAX_TOKENS = 8000;

/** How many tool round-trips one question may take before we stop. */
export const AI_MAX_TURNS = 8;

export function aiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
