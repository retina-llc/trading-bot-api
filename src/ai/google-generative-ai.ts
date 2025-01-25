import axios from "axios";
import { analyzeFluctuations, getHistoricalData } from "../api/api";

export class GenerativeModel {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  public async generateContent(
    prompt: string,
  ): Promise<{ response: { text: () => string } }> {
    try {
      const response = await axios.post(
        "https://api.gemini.com/v1/generate",
        {
          model: this.model,
          prompt: prompt,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
        },
      );

      return {
        response: {
          text: () => response.data.generated_text,
        },
      };
    } catch (error) {
      console.error("Error generating content:", error);
      throw new Error("Failed to generate content");
    }
  }

  // Implement the predict method
  public async predict(symbol: string): Promise<string> {
    try {
      const historicalData = await getHistoricalData(symbol);
      const recommendation = analyzeFluctuations(historicalData);
      return recommendation;
    } catch (error) {
      console.error("Error predicting content:", error);
      throw new Error("Failed to predict content");
    }
  }

  public async startChat(): Promise<any> {
    try {
      const response = await axios.post(
        "https://api.gemini.com/v1/chat/start",
        {},
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
        },
      );

      return {
        getHistory: async () => {
          const historyResponse = await axios.get(
            "https://api.gemini.com/v1/chat/history",
            {
              headers: {
                Authorization: `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
              },
            },
          );
          return historyResponse.data;
        },
      };
    } catch (error) {
      console.error("Error starting chat session:", error);
      throw new Error("Failed to start chat session");
    }
  }
}

export class GoogleGenerativeAI {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  public getGenerativeModel(config: { model: string }): GenerativeModel {
    return new GenerativeModel(this.apiKey, config.model);
  }
}
