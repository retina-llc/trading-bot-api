// src/types/express-session.d.ts

import 'express-session';
import { SessionData } from 'express-session';

declare module 'express-session' {
  interface SessionData {
    token?: string;
  }
}

declare module 'express' {
  interface Request {
    session: SessionData;
  }
}
