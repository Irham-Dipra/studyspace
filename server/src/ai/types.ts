export type AITask = "explain" | "summarize";

export interface AIPageInput {
  task: AITask;
  documentTitle: string;
  /** 1-based page number (or first page of the range). */
  pageStart: number;
  pageEnd: number;
  /** Plain text extracted from the page(s) by the client's PDF.js text layer. */
  text: string;
}

export interface AIResult {
  title: string;
  /** Markdown. */
  content: string;
}

/**
 * Implement this interface to plug in an AI backend (cloud API or a local model server).
 * Register the implementation in `ai/index.ts` under a name and select it with AI_PROVIDER.
 */
export interface AIProvider {
  readonly id: string;
  readonly enabled: boolean;
  /** Human-readable reason shown in the UI when `enabled` is false. */
  readonly statusMessage: string;
  generate(input: AIPageInput): Promise<AIResult>;
}
