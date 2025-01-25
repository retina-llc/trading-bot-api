import { Injectable } from "@nestjs/common";
import { GeminiAIClient } from "./gemini.ai";
import { Prompt } from "./prompts";

interface AIServiceOptions {
  client: string;
}

@Injectable()
export default class AIService {
  private gemini: GeminiAIClient;

  constructor() {
    this.gemini = GeminiAIClient.getInstance();
  }

  async generate(
    prompt: Prompt,
    options: AIServiceOptions = { client: "gemini" },
  ): Promise<string> {
    switch (options.client) {
      case "gemini":
        return this.gemini.generate(prompt);
      default:
        throw new Error(`Unsupported client: ${options.client}`);
    }
  }

  async checkHealth(
    options: AIServiceOptions = { client: "gemini" },
  ): Promise<{ status: string }> {
    switch (options.client) {
      case "gemini":
        return this.gemini.checkAiService();
      default:
        throw new Error(`Unsupported client: ${options.client}`);
    }
  }
}
