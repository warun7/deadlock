import type { NextFunction, Request, Response } from "express";
import { config } from "../config";
import { AuthFailure, demoUser, verifyAccessToken } from "../middleware/AuthMiddleware";
import type { AuthUser } from "../types";

/**
 * Sign-in for the REST endpoints: the same Supabase access token the socket
 * uses, sent as "Authorization: Bearer <token>".
 */

function bearer(req: Request): string | null {
  const header = req.header("authorization");
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1] : null;
}

async function resolve(req: Request): Promise<AuthUser | null> {
  const token = bearer(req);
  if (!token) return null;
  const demo = demoUser(token);
  if (demo) return demo;
  try {
    return await verifyAccessToken(token);
  } catch (error) {
    if (!(error instanceof AuthFailure)) console.error("⚠️ Could not check a sign-in:", error);
    return null;
  }
}

/** 401 unless signed in */
export async function requireUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = await resolve(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to do that." });
    return;
  }
  req.user = user;
  next();
}

/** Attach the user when there is one; never refuses */
export async function optionalUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  req.user = (await resolve(req)) ?? undefined;
  next();
}

export function isAdmin(user: AuthUser | undefined): boolean {
  if (!user) return false;
  return (
    config.admin.userIds.includes(user.id) ||
    (!!user.email && config.admin.emails.includes(user.email.toLowerCase()))
  );
}

/** 401 signed out, 404 for anyone who is not an admin (the page does not exist for them) */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = await resolve(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to do that." });
    return;
  }
  if (!isAdmin(user)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  req.user = user;
  next();
}
