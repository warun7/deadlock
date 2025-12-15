// Type definitions for express-rate-limit
import 'express';

declare module 'express' {
  export interface Request {
    rateLimit?: {
      limit: number;
      current: number;
      remaining: number;
      resetTime: Date;
    };
  }
}
