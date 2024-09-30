import { Prompt } from "./prompts";

export interface IAiService {
  generate(prompt: Prompt): Promise<string>;
  checkAiService(): Promise<{ status: string }>;
}
