// src/shared/token-storage.ts
export class TokenStorage {
  private static tokens = new Map<string, string>();

  static setToken(email: string, token: string): void {
    this.tokens.set(email, token);
  }

  static getToken(email: string): string | undefined {
    return this.tokens.get(email);
  }

  static removeToken(email: string): void {
    this.tokens.delete(email);
  }
}
