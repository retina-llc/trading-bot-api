import { Request } from 'express';

export interface RequestWithUser extends Request {
  user?: {
    id: number;
    email: string;
    // Add other user properties if needed
    [key: string]: any;
  };
}
