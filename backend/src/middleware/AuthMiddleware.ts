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
    
    // Verify the access token. Projects on the legacy shared JWT secret can be
    // checked locally (fast). Projects on Supabase's asymmetric signing keys,
    // or a secret that was rotated without updating this server, fall back to
    // asking Supabase Auth directly, so logins keep working either way.
    let decoded: SupabaseJwtPayload | null = null;

    if (config.supabase.jwtSecret) {
      try {
        decoded = jwt.verify(token, config.supabase.jwtSecret, { algorithms: ['HS256'] }) as SupabaseJwtPayload;
      } catch (jwtError: any) {
        if (jwtError.name === 'TokenExpiredError') {
          console.log('❌ Auth failed: Token expired');
          return next(new Error('Token expired'));
        }
        // Not signed with this secret: let Supabase decide below
      }
    }

    if (!decoded) {
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data?.user) {
        console.log('❌ Auth failed: Invalid token -', error?.message ?? 'no user');
        return next(new Error('Invalid authentication token'));
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
    
    // Check expiration
    if (decoded.exp && decoded.exp * 1000 < Date.now()) {
      console.log('❌ Auth failed: Token expired');
      return next(new Error('Token expired'));
    }
    
    // Get user ID from sub claim
    const userId = decoded.sub;
    if (!userId) {
      console.log('❌ Auth failed: No user ID in token');
      return next(new Error('Invalid token: no user ID'));
    }
    
    // Extract username from token metadata
    let username = decoded.user_metadata?.username ||
                   decoded.user_metadata?.display_name ||
                   decoded.user_metadata?.full_name ||
                   decoded.email?.split('@')[0] ||
                   'Player';
    
    // The profile holds the current username (renames update it, not the
    // token) and the player's rating
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
    
    // Attach user to socket
    const authUser: AuthUser = {
      id: userId,
      email: decoded.email || '',
      username: username,
      elo: elo,
    };
    
    (socket as AuthenticatedSocket).user = authUser;
    
    console.log(`✅ Authenticated: ${username} (${userId}) ELO: ${elo}`);
    next();
    
  } catch (error: any) {
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
  const token = socket.handshake.auth?.token;
  
  // In development, allow demo tokens
  if (config.nodeEnv === 'development' && token?.startsWith('demo_')) {
    const parts = token.split('_');
    const demoUser: AuthUser = {
      id: parts[1] || 'demo-user-1',
      email: `${parts[1] || 'demo'}@demo.com`,
      username: parts[2] || 'DemoPlayer',
      elo: parseInt(parts[3] || '1200', 10),
    };
    
    (socket as AuthenticatedSocket).user = demoUser;
    console.log(`🔧 Dev auth: ${demoUser.username} (${demoUser.id})`);
    return next();
  }
  
  // Otherwise use real auth
  return authMiddleware(socket, next);
}


