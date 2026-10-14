import { HttpError } from "../../types.js";
import type { AIProvider, AIResult } from "../types.js";

/** Default provider: StudySpace runs fully offline and AI actions report that they are not configured. */
export class DisabledProvider implements AIProvider {
  readonly id = "none";
  readonly enabled = false;

  constructor(readonly statusMessage = "AI is not configured. Set AI_PROVIDER (and AI_API_KEY) to enable it.") {}

  async generate(): Promise<AIResult> {
    throw new HttpError(503, this.statusMessage);
  }
}
