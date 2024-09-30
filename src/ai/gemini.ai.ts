import { Injectable } from '@nestjs/common';
import { IAiService } from './ai-service.interface';
import { Prompt } from './prompts';
import { GenerativeModel, GoogleGenerativeAI } from './google-generative-ai';

@Injectable()
export class GeminiAIClient implements IAiService {
  private model: GenerativeModel;
  private static _instance: GeminiAIClient | null = null;

  public constructor() {
    const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    this.model = genai.getGenerativeModel({
      model: 'gemini-pro',
    });
  }

  public static getInstance(): GeminiAIClient {
    if (this._instance === null) {
      this._instance = new GeminiAIClient();
    }
    return this._instance;
  }

  public async generate(prompt: Prompt): Promise<string> {
    try {
      const response = await this.model.generateContent(prompt.message);
      return response.response.text().trim();
    } catch (error) {
      console.error('Error in generate method:', error);
      throw error;
    }
  }

  // Implement checkAiService method
  public async checkAiService(): Promise<{ status: string }> {
    // Implement a health check logic here
    try {
      // Example health check logic (this may vary based on the API)
      const response = await this.model.startChat();
      return { status: 'healthy' };
    } catch (error) {
      console.error('Error in checkAiService:', error);
      return { status: 'unhealthy' };
    }
  }
}
