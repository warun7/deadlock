// Type definitions for express-rate-limit, and the signed-in user (src/http/auth.ts)
import 'express';
import type { AuthUser } from './index';

declare module 'express' {
  export interface Request {
    rateLimit?: {
      limit: number;
      current: number;
      remaining: number;
      resetTime: Date;
    };
    user?: AuthUser;
  }
}

// Route handlers see the core Request type
declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}
