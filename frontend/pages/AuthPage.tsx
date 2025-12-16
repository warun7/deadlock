import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ChevronLeft, Lock, Mail, Key, ArrowRight, AlertTriangle } from 'lucide-react';
import GlitchText from '../components/GlitchText';
import { isSupabaseConfigured } from '../lib/supabase';

const AuthPage: React.FC = () => {
  const navigate = useNavigate();
  const { signUp, signIn, signInWithGoogle, resetPassword, isLoggedIn, loading: authLoading } = useAuth();
  
  const [isLogin, setIsLogin] = useState(true);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Redirect if already logged in (handles OAuth callback)
  // Only redirect once to avoid infinite loops
  // IMPORTANT: Only redirect when ON the auth page, not from other pages
  const hasRedirected = React.useRef(false);
  
  React.useEffect(() => {
    // Check for OAuth errors in URL
    const params = new URLSearchParams(window.location.search);
    const urlError = params.get('error');
    const errorDescription = params.get('error_description');
    
    if (urlError) {
      console.error('❌ OAuth error from URL:', urlError, errorDescription);
      
      let friendlyError = 'Google OAuth authentication failed.';
      
      if (errorDescription?.includes('Unable to exchange external code')) {
        friendlyError = 'Google OAuth configuration error. The redirect URI in Google Cloud Console may not match Supabase. Please check GOOGLE_OAUTH_ERROR_FIX.md for detailed instructions.';
      } else if (errorDescription?.includes('redirect_uri_mismatch')) {
        friendlyError = 'Redirect URI mismatch. The authorized redirect URI in Google Cloud Console must exactly match your Supabase callback URL.';
      } else if (errorDescription) {
        friendlyError = `OAuth Error: ${decodeURIComponent(errorDescription)}`;
      }
      
      setError(friendlyError);
      
      // Clean up URL without reloading
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }
    
    // Only redirect to dashboard if we're ON the auth page
    // Don't redirect if user navigated here from another protected page
    const isOnAuthPage = window.location.pathname === '/auth';
    
    if (isLoggedIn && !authLoading && !hasRedirected.current && isOnAuthPage) {
      console.log('User is logged in on auth page, redirecting to dashboard...');
      hasRedirected.current = true;
      navigate('/dashboard', { replace: true });
    }
  }, [isLoggedIn, authLoading, navigate]);

  const handleBack = () => {
    if (isLoggedIn) {
      navigate('/dashboard');
    } else {
      navigate('/');
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    // Validate registration fields
    if (!isLogin) {
      if (!username || username.trim().length < 3) {
        setError('Username must be at least 3 characters');
        setLoading(false);
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        setLoading(false);
        return;
      }
      if (password.length < 6) {
        setError('Password must be at least 6 characters');
        setLoading(false);
        return;
      }
    }

    try {
      const { error: authError } = isLogin
        ? await signIn(email, password)
        : await signUp(email, password, username);

      if (authError) {
        setError(authError.message);
        setLoading(false);
      } else {
        // Success - redirect to dashboard
        if (!isLogin) {
          setSuccess('Account created! Redirecting...');
          setTimeout(() => navigate('/dashboard'), 1500);
        } else {
          navigate('/dashboard');
        }
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
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
        setSuccess('Password reset link sent! Check your email.');
        setTimeout(() => {
          setShowForgotPassword(false);
          setLoading(false);
          setEmail('');
        }, 2000);
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
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
    } else {
      // In demo mode, show success and redirect
      if (!isSupabaseConfigured()) {
        setSuccess('Demo login successful! Redirecting...');
        setTimeout(() => {
          navigate('/dashboard');
        }, 1000);
      }
      // For real OAuth, redirect happens automatically via Supabase
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center p-4 relative overflow-hidden font-mono">
      {/* Background Effects */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#222_1px,transparent_1px),linear-gradient(to_bottom,#222_1px,transparent_1px)] bg-[size:40px_40px] opacity-10 [transform:perspective(1000px)_rotateX(60deg)] origin-top h-1/2"></div>
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_center,transparent_0%,#050505_100%)]"></div>
      </div>

      {/* Back Button */}
      <button
        onClick={handleBack}
        className="absolute top-6 left-6 flex items-center gap-2 text-stone-500 hover:text-white transition-colors group z-50"
      >
        <ChevronLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
        <span className="text-sm font-bold tracking-wider">Abort_Sequence</span>
      </button>

      {/* Main Auth Container */}
      <div className="w-full max-w-md relative z-10">
        <div className="bg-stone-950/50 border border-stone-800 backdrop-blur-md rounded-sm p-8 relative overflow-hidden">
          {/* Scanline Effect */}
          <div className="absolute inset-0 pointer-events-none opacity-5">
            <div className="absolute inset-0 bg-[linear-gradient(transparent_50%,rgba(255,255,255,0.05)_50%)] bg-[length:100%_4px]"></div>
          </div>

          {/* Supabase Info Banner */}
          {!showForgotPassword && !isSupabaseConfigured() && (
            <div className="mb-4 p-3 bg-yellow-950/20 border border-yellow-900/30 rounded flex items-start gap-2 text-yellow-500 text-xs">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <strong>DEMO MODE:</strong> Authentication works but data is not saved. 
                <a 
                  href="/SUPABASE_SETUP.md" 
                  target="_blank"
                  className="underline hover:text-yellow-400 ml-1"
                >
                  Set up Supabase
                </a> for real authentication.
              </div>
            </div>
          )}

          {/* Header */}
          <div className="text-center mb-8 relative">
            <div className="inline-flex items-center gap-2 mb-4 px-3 py-1 bg-red-950/20 border border-red-900/30 rounded text-red-500 text-xs">
              <Lock className="w-3 h-3" />
              <span>SECURE_GATEWAY // 443</span>
            </div>
            <h2 className="text-3xl font-black mb-2">
              <GlitchText text={showForgotPassword ? 'RESET_PASSWORD' : isLogin ? 'SYSTEM_LOGIN' : 'CREATE_ACCOUNT'} />
            </h2>
            <p className="text-stone-500 text-sm">
              {showForgotPassword 
                ? 'Recover access to your account' 
                : isLogin 
                  ? 'Enter credentials to access mainframe' 
                  : 'Initialize new user profile'
              }
            </p>
          </div>

          {/* Tab Switcher */}
          {!showForgotPassword && (
            <div className="flex gap-2 mb-6 bg-black/50 p-1 rounded">
              <button
                onClick={() => {
                  setIsLogin(true);
                  setError(null);
                  setSuccess(null);
                }}
                className={`flex-1 py-2 text-sm font-bold rounded transition-all ${
                  isLogin
                    ? 'bg-red-600 text-white'
                    : 'text-stone-500 hover:text-white'
                }`}
              >
                Login
              </button>
              <button
                onClick={() => {
                  setIsLogin(false);
                  setError(null);
                  setSuccess(null);
                  setConfirmPassword('');
                }}
                className={`flex-1 py-2 text-sm font-bold rounded transition-all ${
                  !isLogin
                    ? 'bg-red-600 text-white'
                    : 'text-stone-500 hover:text-white'
                }`}
              >
                Register
              </button>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-3 bg-red-950/30 border border-red-900/50 rounded flex items-start gap-2 text-red-400 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="mb-4 p-3 bg-green-950/30 border border-green-900/50 rounded flex items-start gap-2 text-green-400 text-sm">
              <div className="w-4 h-4 mt-0.5 flex-shrink-0 rounded-full bg-green-500/20 flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-green-500"></div>
              </div>
              <span>{success}</span>
            </div>
          )}

          {/* Forgot Password View */}
          {showForgotPassword ? (
            <>
              <div className="mb-6 text-center">
                <h3 className="text-lg font-bold text-white mb-2">Reset Password</h3>
                <p className="text-sm text-stone-500">
                  Enter your email to receive a password reset link
                </p>
              </div>

              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div>
                  <label className="block text-xs text-stone-500 mb-2 font-bold">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-600" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="usr@deadlock.dev"
                      required
                      disabled={loading}
                      className="w-full bg-black/50 border border-stone-800 rounded pl-10 pr-4 py-3 text-white placeholder:text-stone-700 focus:border-red-600 focus:outline-none transition-colors disabled:opacity-50"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-red-600 hover:bg-red-500 text-white font-black py-3 rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'SENDING...' : 'SEND RESET LINK'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowForgotPassword(false);
                    setError(null);
                    setSuccess(null);
                  }}
                  className="w-full text-sm text-stone-500 hover:text-white transition-colors"
                >
                  ← Back to Login
                </button>
              </form>
            </>
          ) : (
            <>
              {/* Google OAuth Button */}
              <button
                onClick={handleGoogleAuth}
                disabled={loading}
                className="w-full mb-4 px-4 py-3 bg-white hover:bg-stone-100 text-black font-bold rounded flex items-center justify-center gap-3 transition-all disabled:opacity-50 disabled:cursor-not-allowed relative overflow-hidden"
                title={isSupabaseConfigured() ? "Sign in with Google" : "Demo mode - instant login"}
              >
                <img 
                  src="https://www.svgrepo.com/show/475656/google-color.svg" 
                  alt="Google" 
                  className="w-5 h-5" 
                />
                <span className="relative z-10">Continue with Google</span>
              </button>

              {/* Divider */}
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-stone-800"></div>
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-stone-950 px-4 text-stone-600 font-bold">
                    OR USE ENCRYPTION KEY
                  </span>
                </div>
              </div>

              {/* Email/Password Form */}
              <form onSubmit={handleEmailAuth} className="space-y-4">
                {/* Username Field (Register Only) */}
                {!isLogin && (
                  <div>
                    <label className="block text-xs text-stone-500 mb-2 font-bold">
                      Username // Display Name
                    </label>
                    <div className="relative">
                      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="Codemaster_99"
                        required={!isLogin}
                        minLength={3}
                        disabled={loading}
                        className="w-full bg-black/50 border border-stone-800 rounded pl-10 pr-4 py-3 text-white placeholder:text-stone-700 focus:border-red-600 focus:outline-none transition-colors disabled:opacity-50"
                      />
                    </div>
                  </div>
                )}

                {/* Email Field */}
                <div>
                  <label className="block text-xs text-stone-500 mb-2 font-bold">
                    Identity // Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-600" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="usr@deadlock.dev"
                      required
                      disabled={loading}
                      className="w-full bg-black/50 border border-stone-800 rounded pl-10 pr-4 py-3 text-white placeholder:text-stone-700 focus:border-red-600 focus:outline-none transition-colors disabled:opacity-50"
                    />
                  </div>
                </div>

                {/* Password Field */}
                <div>
                  <label className="block text-xs text-stone-500 mb-2 font-bold">
                    Passphrase {!isLogin && '(min 6 characters)'}
                  </label>
                  <div className="relative">
                    <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-600" />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      required
                      minLength={6}
                      disabled={loading}
                      className="w-full bg-black/50 border border-stone-800 rounded pl-10 pr-4 py-3 text-white placeholder:text-stone-700 focus:border-red-600 focus:outline-none transition-colors disabled:opacity-50"
                    />
                  </div>
                </div>

                {/* Confirm Password Field (Register Only) */}
                {!isLogin && (
                  <div>
                    <label className="block text-xs text-stone-500 mb-2 font-bold">
                      Confirm Passphrase
                    </label>
                    <div className="relative">
                      <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-600" />
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••••••"
                        required
                        minLength={6}
                        disabled={loading}
                        className="w-full bg-black/50 border border-stone-800 rounded pl-10 pr-4 py-3 text-white placeholder:text-stone-700 focus:border-red-600 focus:outline-none transition-colors disabled:opacity-50"
                      />
                    </div>
                  </div>
                )}

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-red-600 hover:bg-red-500 text-white font-black py-3 rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 group"
                >
                  <span className="relative z-10">
                    {loading ? 'INITIALIZING...' : isLogin ? 'EXECUTE' : 'CREATE_PROFILE'}
                  </span>
                  {!loading && (
                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  )}
                </button>
              </form>

              {/* Footer Links */}
              <div className="mt-6 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-green-500">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="font-mono">SYSTEM ONLINE</span>
                </div>
                <div className="flex gap-4 text-stone-600">
                  {isLogin && (
                    <button
                      onClick={() => {
                        setShowForgotPassword(true);
                        setError(null);
                        setSuccess(null);
                      }}
                      className="hover:text-red-500 transition-colors"
                    >
                      RECOVER_PWD
                    </button>
                  )}
                  <a href="#" className="hover:text-red-500 transition-colors">
                    HELP
                  </a>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Terms */}
        <p className="text-center text-xs text-stone-700 mt-4">
          By accessing this system you agree to the{' '}
          <a href="#" className="text-red-500 hover:underline">
            Terms of Service
          </a>{' '}
          and{' '}
          <a href="#" className="text-red-500 hover:underline">
            Privacy Protocols
          </a>
          .
        </p>
      </div>
    </div>
  );
};

export default AuthPage;
