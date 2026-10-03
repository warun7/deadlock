import { Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AuthUser, AuthenticatedSocket } from '../types';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client for user data lookup
const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey
);

interface SupabaseJwtPayload {
  sub: string;          // User ID
  email?: string;
  user_metadata?: {
    username?: string;
    display_name?: string;
    full_name?: string;
  };
  app_metadata?: {
    provider?: string;
  };
  iat: number;
  exp: number;
  aud: string;
}

/** A failed sign-in check, with the message the socket handshake reports */
export class AuthFailure extends Error {}

/**
 * Who an access token belongs to. Projects on the legacy shared JWT secret are
 * checked locally (fast); projects on Supabase's asymmetric signing keys, or a
 * secret rotated without updating this server, fall back to asking Supabase
 * Auth directly. The profile supplies the current username (renames update
 * it, not the token) and rating. Throws AuthFailure.
 */
export async function verifyAccessToken(token: string): Promise<AuthUser> {
  let decoded: SupabaseJwtPayload | null = null;

  if (config.supabase.jwtSecret) {
    try {
      decoded = jwt.verify(token, config.supabase.jwtSecret, { algorithms: ['HS256'] }) as SupabaseJwtPayload;
    } catch (jwtError: any) {
      if (jwtError.name === 'TokenExpiredError') throw new AuthFailure('Token expired');
      // Not signed with this secret: let Supabase decide below
    }
  }

  if (!decoded) {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      console.log('❌ Auth failed: Invalid token -', error?.message ?? 'no user');
      throw new AuthFailure('Invalid authentication token');
    }
    decoded = {
      sub: data.user.id,
      email: data.user.email,
      user_metadata: data.user.user_metadata,
      iat: 0,
      exp: 0,
      aud: data.user.aud,
    };
  }

  if (decoded.exp && decoded.exp * 1000 < Date.now()) throw new AuthFailure('Token expired');

  const userId = decoded.sub;
  if (!userId) throw new AuthFailure('Invalid token: no user ID');

  let username = decoded.user_metadata?.username ||
                 decoded.user_metadata?.display_name ||
                 decoded.user_metadata?.full_name ||
                 decoded.email?.split('@')[0] ||
                 'Player';
  let elo = 1000; // Same default as profiles.rating

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('username, rating')
      .eq('id', userId)
      .single();

    if (profile) {
      username = profile.username || username;
      if (typeof profile.rating === 'number') elo = profile.rating;
    }
  } catch (dbError) {
    // Profile might not exist yet, use defaults
    console.log(`ℹ️  No profile found for user ${userId}, using defaults`);
  }

  return { id: userId, email: decoded.email || '', username, elo };
}

/** Demo tokens (demo_<id>_<name>_<rating>), accepted in development only */
export function demoUser(token: string | undefined): AuthUser | null {
  if (config.nodeEnv !== 'development' || !token?.startsWith('demo_')) return null;
  const parts = token.split('_');
  return {
    id: parts[1] || 'demo-user-1',
    email: `${parts[1] || 'demo'}@demo.com`,
    username: parts[2] || 'DemoPlayer',
    elo: parseInt(parts[3] || '1200', 10),
  };
}

/**
 * Socket.io Authentication Middleware
 *
 * Verifies the Supabase JWT token from the handshake auth payload.
 * Attaches user data to the socket for global access.
 */
export async function authMiddleware(
  socket: Socket,
  next: (err?: Error) => void
): Promise<void> {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      console.log('❌ Auth failed: No token provided');
      return next(new Error('Authentication required'));
    }

    const authUser = await verifyAccessToken(token);
    (socket as AuthenticatedSocket).user = authUser;

    console.log(`✅ Authenticated: ${authUser.username} (${authUser.id}) ELO: ${authUser.elo}`);
    next();
  } catch (error: any) {
    if (error instanceof AuthFailure) {
      console.log(`❌ Auth failed: ${error.message}`);
      return next(new Error(error.message));
    }
    console.error('❌ Auth middleware error:', error.message);
    next(new Error('Authentication failed'));
  }
}

/**
 * Simple token extractor for testing/development
 * Allows connections with a demo token for testing
 */
export async function devAuthMiddleware(
  socket: Socket,
  next: (err?: Error) => void
): Promise<void> {
  const demo = demoUser(socket.handshake.auth?.token);
  if (demo) {
    (socket as AuthenticatedSocket).user = demo;
    console.log(`🔧 Dev auth: ${demo.username} (${demo.id})`);
    return next();
  }

  // Otherwise use real auth
  return authMiddleware(socket, next);
}
