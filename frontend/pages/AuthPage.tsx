import React, { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, CheckCircle, GoogleLogo, WarningCircle } from "@phosphor-icons/react";
import { useAuth } from "../contexts/AuthContext";
import AuthLayout from "../components/app/AuthLayout";
import Field from "../components/ui/Field";
import { Button } from "../components/ui/Button";
import { isSupabaseConfigured } from "../lib/supabase";

const swap = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] as const },
};

const AuthPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { signUp, signIn, signInWithGoogle, resetPassword, isLoggedIn, loading: authLoading } = useAuth();

  const [isLogin, setIsLogin] = useState(searchParams.get("mode") !== "signup");
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Redirect if already logged in (handles the OAuth callback). Only redirect once,
  // and only while this page is the one on screen.
  const hasRedirected = React.useRef(false);
  const mountTime = React.useRef(Date.now());
  const isMounted = React.useRef(true);

  React.useEffect(() => {
    isMounted.current = true;

    const params = new URLSearchParams(window.location.search);
    const urlError = params.get("error");
    const errorDescription = params.get("error_description");

    if (urlError) {
      console.error("OAuth error from URL:", urlError, errorDescription);
      let friendlyError = "Google sign-in failed. Please try again.";
      if (errorDescription?.includes("Unable to exchange external code")) {
        friendlyError =
          "Google sign-in is misconfigured: the redirect URI in Google Cloud Console must exactly match the Supabase callback URL.";
      } else if (errorDescription?.includes("redirect_uri_mismatch")) {
        friendlyError =
          "Redirect URI mismatch: the authorized redirect URI in Google Cloud Console must exactly match the Supabase callback URL.";
      } else if (errorDescription) {
        friendlyError = decodeURIComponent(errorDescription);
      }
      setError(friendlyError);
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    const isOnAuthPage = window.location.pathname === "/auth";
    const timeSinceMount = Date.now() - mountTime.current;
    const shouldRedirect = isLoggedIn && !authLoading && !hasRedirected.current && isOnAuthPage && timeSinceMount > 100;

    if (shouldRedirect) {
      if (!isMounted.current || window.location.pathname !== "/auth") return;
      hasRedirected.current = true;
      setTimeout(() => {
        if (isMounted.current && window.location.pathname === "/auth") {
          navigate("/dashboard", { replace: true });
        }
      }, 50);
    }

    return () => {
      isMounted.current = false;
    };
  }, [isLoggedIn, authLoading, navigate]);

  const switchMode = (login: boolean) => {
    setIsLogin(login);
    setLoading(false);
    setError(null);
    setSuccess(null);
    setConfirmPassword("");
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    if (!isLogin) {
      if (!username || username.trim().length < 3) {
        setError("Username must be at least 3 characters.");
        setLoading(false);
        return;
      }
      if (password.length < 6) {
        setError("Password must be at least 6 characters.");
        setLoading(false);
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        setLoading(false);
        return;
      }
    }

    try {
      const { error: authError } = isLogin ? await signIn(email, password) : await signUp(email, password, username);
      if (authError) {
        setError(authError.message);
        setLoading(false);
      } else if (!isLogin) {
        setSuccess("Account created. Taking you to the lobby.");
        setTimeout(() => navigate("/dashboard"), 1200);
      } else {
        navigate("/dashboard");
      }
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const { error: resetError } = await resetPassword(email);
      if (resetError) {
        setError(resetError.message);
        setLoading(false);
      } else {
        setSuccess(`Reset link sent to ${email}. Check your inbox.`);
        setLoading(false);
      }
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    const { error: authError } = await signInWithGoogle();
    if (authError) {
      setError(authError.message);
      setLoading(false);
    } else if (!isSupabaseConfigured()) {
      setSuccess("Demo login successful. Redirecting.");
      setTimeout(() => navigate("/dashboard"), 800);
    }
    // For real OAuth, Supabase redirects the browser.
  };

  const messages = (
    <>
      {error && (
        <div role="alert" className="flex items-start gap-2.5 rounded-[3px] border border-accent-ink/40 px-3 py-2.5 text-sm text-accent-ink">
          <WarningCircle className="mt-0.5 size-4 shrink-0" weight="bold" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div role="status" className="flex items-start gap-2.5 rounded-[3px] border border-pass-ink/40 px-3 py-2.5 text-sm text-pass-ink">
          <CheckCircle className="mt-0.5 size-4 shrink-0" weight="bold" />
          <span>{success}</span>
        </div>
      )}
    </>
  );

  return (
    <AuthLayout backTo={isLoggedIn ? "/dashboard" : "/"} backLabel={isLoggedIn ? "Lobby" : "Home"}>
      {!isSupabaseConfigured() && (
        <p className="mb-8 flex gap-2 rounded-[3px] border border-warn-ink/40 px-3 py-2.5 text-[13px] leading-relaxed text-warn-ink">
          <span className="label shrink-0 pt-px">Demo:</span>
          Supabase is not configured, so accounts and matches are not saved.
        </p>
      )}

      <AnimatePresence mode="wait" initial={false}>
        {showForgotPassword ? (
          <motion.div key="forgot" {...swap}>
            <p className="label text-fg-3">Account</p>
            <h1 className="mt-3 text-[clamp(2.5rem,4vw,3.5rem)] font-medium leading-[0.92] tracking-[-0.055em] text-fg">Reset password</h1>
            <p className="mt-4 text-[17px] leading-snug text-fg-2">We will email you a link to set a new one.</p>
            <form onSubmit={handleForgotPassword} className="mt-8 space-y-5">
              <Field
                label="Email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
                autoFocus
              />
              {messages}
              <Button type="submit" size="lg" loading={loading} className="w-full">
                {loading ? "Sending" : "Send reset link"}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setShowForgotPassword(false);
                  setLoading(false);
                  setError(null);
                  setSuccess(null);
                }}
                className="label mx-auto flex items-center gap-1.5 text-fg-2 transition-colors hover:text-fg"
              >
                <ArrowLeft className="size-3.5" /> Back to log in
              </button>
            </form>
          </motion.div>
        ) : (
          <motion.div key="main" {...swap}>
            <p className="label text-fg-3">Account</p>
            <h1 className="mt-3 text-[clamp(2.5rem,4vw,3.5rem)] font-medium leading-[0.92] tracking-[-0.055em] text-fg">
              {isLogin ? "Welcome back" : "Get in the queue"}
            </h1>
            <p className="mt-4 text-[17px] leading-snug text-fg-2">
              {isLogin ? "Log in and pick up where you left off." : "Free to play. Takes under a minute."}
            </p>

            <div className="mt-8 grid grid-cols-2 gap-[3px]" role="tablist" aria-label="Account">
              {[
                { id: true, label: "Log in" },
                { id: false, label: "Sign up" },
              ].map((t) => (
                <button
                  key={t.label}
                  type="button"
                  role="tab"
                  aria-selected={isLogin === t.id}
                  onClick={() => switchMode(t.id)}
                  className={`label relative h-9 rounded-[3px] transition-colors ${isLogin === t.id ? "text-bg" : "bg-bg-2 text-fg hover:bg-bg-3"}`}
                >
                  {isLogin === t.id && (
                    <motion.span
                      layoutId="auth-tab"
                      className="absolute inset-0 rounded-[3px] bg-fg"
                      transition={{ type: "spring", stiffness: 500, damping: 40 }}
                    />
                  )}
                  <span className="relative">{t.label}</span>
                </button>
              ))}
            </div>

            <Button type="button" variant="outline" size="lg" className="mt-6 w-full" onClick={handleGoogleAuth} disabled={loading}>
              <GoogleLogo weight="bold" className="size-4" />
              Continue with Google
            </Button>

            <div className="label my-7 flex items-center gap-3 text-fg-3" aria-hidden="true">
              <span className="h-px flex-1 bg-line" />
              Or with email
              <span className="h-px flex-1 bg-line" />
            </div>

            <form onSubmit={handleEmailAuth} className="space-y-5" noValidate={false}>
              {!isLogin && (
                <Field
                  label="Username"
                  hint="At least 3 characters. Shown to your opponents."
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  minLength={3}
                  disabled={loading}
                />
              )}
              <Field
                label="Email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
              <Field
                label="Password"
                type="password"
                autoComplete={isLogin ? "current-password" : "new-password"}
                hint={isLogin ? undefined : "At least 6 characters."}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                disabled={loading}
                labelAside={
                  isLogin ? (
                    <button
                      type="button"
                      onClick={() => {
                        setShowForgotPassword(true);
                        setError(null);
                        setSuccess(null);
                      }}
                      className="label text-fg-3 transition-colors hover:text-fg"
                    >
                      Forgot password?
                    </button>
                  ) : undefined
                }
              />
              {!isLogin && (
                <Field
                  label="Confirm password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                  disabled={loading}
                  error={confirmPassword && password !== confirmPassword ? "Passwords do not match." : null}
                />
              )}

              {messages}

              <Button type="submit" size="lg" loading={loading} className="w-full">
                {isLogin ? (loading ? "Logging in" : "Log in") : loading ? "Creating account" : "Create account"}
              </Button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </AuthLayout>
  );
};

export default AuthPage;
