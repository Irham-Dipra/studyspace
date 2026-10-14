import type { AIConfig } from "../config.js";
import { DisabledProvider } from "./providers/none.js";
import type { AIProvider } from "./types.js";

export type { AIProvider, AIPageInput, AIResult, AITask } from "./types.js";

type Factory = (cfg: AIConfig) => AIProvider;

/**
 * Provider registry. To add a provider: create `providers/<name>.ts` implementing `AIProvider`,
 * add it here, then run with `AI_PROVIDER=<name>` (plus AI_API_KEY / AI_MODEL / AI_BASE_URL as needed).
 */
const registry: Record<string, Factory> = {
  none: () => new DisabledProvider(),
};

export function createAIProvider(cfg: AIConfig): AIProvider {
  const factory = registry[cfg.provider];
  if (!factory) {
    return new DisabledProvider(`Unknown AI_PROVIDER "${cfg.provider}". Available: ${Object.keys(registry).join(", ")}.`);
  }
  return factory(cfg);
}

/** Builds the prompt any text-generation provider can send. Kept here so providers stay thin. */
export function buildPrompt(input: { task: string; documentTitle: string; pageStart: number; pageEnd: number; text: string }): string {
  const pages = input.pageStart === input.pageEnd ? `page ${input.pageStart}` : `pages ${input.pageStart}-${input.pageEnd}`;
  const ask =
    input.task === "summarize"
      ? "Summarise the key points as concise Markdown bullet points."
      : "Explain the content clearly for a university student, in Markdown, with short examples where useful.";
  return `You are helping a student study "${input.documentTitle}" (${pages}).\n${ask}\n\n---\n${input.text.slice(0, 20000)}`;
}
