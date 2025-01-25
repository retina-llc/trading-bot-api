// src/users/user.interface.ts

export interface User {
  id: number;
  email: string;
  has_subscription: boolean;
  partial_usd_balance: number;

  // Add other relevant properties as needed
}
