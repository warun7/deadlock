import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { User, AuthError } from "@supabase/supabase-js";
import { identify } from "../lib/analytics";

/** What a sign-up led to. With email confirmation on, there is no session until the link is opened. */
export interface SignUpResult {
  error: AuthError | null;
  /** Account made; the confirmation email is on its way */
  needsConfirmation: boolean;
  /** That email already has an account (Supabase answers this way to avoid revealing it outright) */
  alreadyRegistered: boolean;
}

/** Where the confirmation link should land: back on /auth, then on to `next` */
export const confirmRedirect = (next: string | null) =>
  `${window.location.origin}/auth${next ? `?next=${encodeURIComponent(next)}` : ""}`;

interface AuthContextType {
  isLoggedIn: boolean;
  user: User | null;
  loading: boolean;
  login: () => void;
  logout: () => void;
  signUp: (
    email: string,
    password: string,
    username?: string,
    /** The in-app page to come back to (an invite), carried through the confirmation link */
    next?: string | null
  ) => Promise<SignUpResult>;
  resendConfirmation: (email: string, next?: string | null) => Promise<{ error: AuthError | null }>;
  signIn: (
    email: string,
    password: string
  ) => Promise<{ error: AuthError | null }>;
  signInWithGoogle: () => Promise<{ error: AuthError | null }>;
  resetPassword: (email: string) => Promise<{ error: AuthError | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if Supabase is configured
    if (!isSupabaseConfigured()) {
      console.warn("⚠️ Supabase not configured. Running in demo mode.");
      setLoading(false);
      return;
    }

    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setIsLoggedIn(!!session?.user);
      setLoading(false);
      if (session?.user) identify(session.user.id);
    });

    // Listen for auth changes (including OAuth callbacks)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log(
        "Auth state changed:",
        event,
        session?.user?.email || "no user"
      );

      setUser(session?.user ?? null);
      setIsLoggedIn(!!session?.user);
      if (session?.user) identify(session.user.id);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Demo mode login (fallback when Supabase not configured)
  const login = () => {
    setIsLoggedIn(true);
    const demoUser: Partial<User> = {
      id: "demo-user",
      email: "demo@deadlock.dev",
      user_metadata: { username: "DemoUser" },
    };
    setUser(demoUser as User);
  };

  const logout = async () => {
    try {
      if (isSupabaseConfigured()) {
        // Sign out with scope 'global' to clear all sessions and cookies
        const { error } = await supabase.auth.signOut({ scope: "global" });

        if (error) {
          console.error("Supabase signOut error:", error);
        }
      }

      // Clear local state
      setIsLoggedIn(false);
      setUser(null);
    } catch (err) {
      console.error("Logout error:", err);
      // Still clear local state even if Supabase fails
      setIsLoggedIn(false);
      setUser(null);
    }
  };

  const signUp = async (email: string, password: string, username?: string, next?: string | null): Promise<SignUpResult> => {
    if (!isSupabaseConfigured()) {
      // Demo mode
      const demoUser: Partial<User> = {
        id: "demo-user",
        email: email,
        user_metadata: { username: username || email.split("@")[0] },
      };
      setUser(demoUser as User);
      setIsLoggedIn(true);
      return { error: null, needsConfirmation: false, alreadyRegistered: false };
    }

    const name = username || email.split("@")[0];
    const fromInvite = !!next?.startsWith("/duel/");
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // The confirmation link comes back to this site, then on to the invite
        emailRedirectTo: confirmRedirect(next ?? null),
        data: {
          username: name,
          display_name: name,
          // For the funnel report: sign-ups that came from an invite link
          ...(fromInvite ? { signup_source: "invite", invite_code: next!.split("/")[2] } : {}),
        },
      },
    });

    if (error) return { error, needsConfirmation: false, alreadyRegistered: false };

    // Signed straight in (email confirmation is off)
    if (data.session && data.user) {
      setUser(data.user);
      setIsLoggedIn(true);
      return { error: null, needsConfirmation: false, alreadyRegistered: false };
    }
    // An existing account comes back as a user with no identities
    if (data.user && (data.user.identities?.length ?? 0) === 0) {
      return { error: null, needsConfirmation: false, alreadyRegistered: true };
    }
    return { error: null, needsConfirmation: true, alreadyRegistered: false };
  };

  const resendConfirmation = async (email: string, next?: string | null) => {
    if (!isSupabaseConfigured()) return { error: null };
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: confirmRedirect(next ?? null) },
    });
    return { error };
  };

  const signIn = async (email: string, password: string) => {
    if (!isSupabaseConfigured()) {
      // Demo mode
      login();
      return { error: null };
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error("❌ Sign in error:", error.message);

        // Provide more helpful error messages
        let friendlyError = error.message;

        if (error.message.includes("Invalid login credentials")) {
          friendlyError =
            "Invalid email or password. Please check your credentials and try again.";
        } else if (error.message.includes("Email not confirmed")) {
          friendlyError =
            "Please verify your email address before signing in. Check your inbox for a confirmation email.";
        } else if (error.message.includes("User not found")) {
          friendlyError =
            "No account found with this email. Please register first.";
        }

        return { error: { ...error, message: friendlyError } as AuthError };
      }

      if (data.user) {
        setUser(data.user);
        setIsLoggedIn(true);
      }

      return { error: null };
    } catch (err: any) {
      console.error("❌ Exception during sign in:", err);
      return {
        error: {
          message: err.message || "An unexpected error occurred during sign in",
          name: "AuthError",
          status: 500,
        } as AuthError,
      };
    }
  };

  const signInWithGoogle = async () => {
    if (!isSupabaseConfigured()) {
      // Demo mode - simulate successful Google login
      setTimeout(() => {
        login();
      }, 500);
      return { error: null };
    }

    try {
      // Come back to the site that started the login (not Supabase's default
      // Site URL). The origin must be listed under Authentication > URL
      // Configuration > Redirect URLs in Supabase, or Supabase falls back to Site URL.
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth` },
      });

      if (error) {
        console.error("❌ Google OAuth error:", error);

        // If Google provider is not enabled in Supabase, show helpful error
        if (error?.message?.includes("provider is not enabled")) {
          return {
            error: {
              message:
                "Google OAuth not configured. Enable it in Supabase Dashboard > Authentication > Providers > Google",
              name: "AuthError",
              status: 400,
            } as AuthError,
          };
        }

        return { error };
      }

      return { error: null };
    } catch (err: any) {
      console.error("❌ Exception in Google OAuth:", err);
      return {
        error: {
          message: err.message || "Failed to sign in with Google",
          name: "AuthError",
          status: 400,
        } as AuthError,
      };
    }
  };

  const resetPassword = async (email: string) => {
    if (!isSupabaseConfigured()) {
      // Demo mode - just return success
      return { error: null };
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });

    return { error };
  };

  return (
    <AuthContext.Provider
      value={{
        isLoggedIn,
        user,
        loading,
        login,
        logout,
        signUp,
        resendConfirmation,
        signIn,
        signInWithGoogle,
        resetPassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
