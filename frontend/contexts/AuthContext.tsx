import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { User, AuthError } from "@supabase/supabase-js";

interface AuthContextType {
  isLoggedIn: boolean;
  user: User | null;
  loading: boolean;
  login: () => void;
  logout: () => void;
  signUp: (
    email: string,
    password: string,
    username?: string
  ) => Promise<{ error: AuthError | null }>;
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

      if (event === "SIGNED_IN" && session?.user) {
        console.log("✅ User signed in successfully");
      }

      if (event === "INITIAL_SESSION" && session?.user) {
        console.log("✅ Found existing session");
      }
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
    console.log("🚪 Logout called");
    try {
      if (isSupabaseConfigured()) {
        console.log("Signing out from Supabase...");

        // Sign out with scope 'global' to clear all sessions and cookies
        const { error } = await supabase.auth.signOut({ scope: "global" });

        if (error) {
          console.error("Supabase signOut error:", error);
        } else {
          console.log("✅ Supabase sign out successful");
        }
      }

      // Clear local state
      setIsLoggedIn(false);
      setUser(null);

      // Clear all cookies manually
      document.cookie.split(";").forEach((cookie) => {
        const name = cookie.split("=")[0].trim();
        // Clear for current domain and all parent domains
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=${window.location.hostname}`;
      });

      // Clear localStorage and sessionStorage
      try {
        localStorage.clear();
        sessionStorage.clear();
        console.log("✅ Cleared all browser storage");
      } catch (storageErr) {
        console.warn("Could not clear storage:", storageErr);
      }

      console.log("✅ Logout complete - all session data cleared");
    } catch (err) {
      console.error("Logout error:", err);
      // Still clear local state even if Supabase fails
      setIsLoggedIn(false);
      setUser(null);

      // Try to clear storage anyway
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        // Ignore errors
      }
    }
  };

  const signUp = async (email: string, password: string, username?: string) => {
    if (!isSupabaseConfigured()) {
      // Demo mode
      const demoUser: Partial<User> = {
        id: "demo-user",
        email: email,
        user_metadata: { username: username || email.split("@")[0] },
      };
      setUser(demoUser as User);
      setIsLoggedIn(true);
      return { error: null };
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: username || email.split("@")[0], // Use username or fallback to email prefix
          display_name: username || email.split("@")[0],
        },
      },
    });

    if (!error && data.user) {
      setUser(data.user);
      setIsLoggedIn(true);
    }

    return { error };
  };

  const signIn = async (email: string, password: string) => {
    if (!isSupabaseConfigured()) {
      // Demo mode
      login();
      return { error: null };
    }

    try {
      console.log("🔐 Attempting sign in for:", email);

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
        console.log("✅ Sign in successful for:", data.user.email);
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
      console.log("✅ Demo Mode: Simulating Google OAuth login");
      setTimeout(() => {
        login();
      }, 500);
      return { error: null };
    }

    try {
      console.log("🔐 Starting Google OAuth flow...");

      // Use the simplest possible configuration as per Supabase docs
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
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

      console.log("✅ Google OAuth initiated, redirecting...");
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
