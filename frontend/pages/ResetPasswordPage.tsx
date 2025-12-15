import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ChevronLeft, Lock, Key, AlertTriangle, CheckCircle } from 'lucide-react';
import GlitchText from '../components/GlitchText';

const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Check for recovery token in URL hash
  useEffect(() => {
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.substring(1)); // Remove the '#'
    
    const errorParam = params.get('error');
    const errorDescription = params.get('error_description');
    
    if (errorParam) {
      console.error('❌ Password reset error:', errorParam, errorDescription);
      
      if (errorDescription?.includes('expired')) {
        setError('This password reset link has expired. Please request a new one.');
      } else if (errorDescription?.includes('invalid')) {
        setError('This password reset link is invalid. Please request a new one.');
      } else {
        setError('Password reset link error. Please request a new one.');
      }
    }
  }, []);

  const handleBack = () => {
    navigate('/auth');
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Validate passwords
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      setLoading(false);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    try {
      console.log('🔐 Attempting to update password...');
      
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (updateError) {
        console.error('❌ Password update error:', updateError);
        setError(updateError.message);
        setLoading(false);
      } else {
        console.log('✅ Password updated successfully');
        setSuccess(true);
        
        // Redirect to auth page after 2 seconds
        setTimeout(() => {
          navigate('/auth');
        }, 2000);
      }
    } catch (err: any) {
      console.error('❌ Exception during password reset:', err);
      setError(err.message || 'An error occurred while resetting your password');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center p-4 font-mono relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(220,38,38,0.1),transparent_70%)]"></div>
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:40px_40px]"></div>

      {/* Back Button */}
      <button
        onClick={handleBack}
        className="fixed top-8 left-8 flex items-center gap-2 text-stone-500 hover:text-white transition-colors z-10"
      >
        <ChevronLeft className="w-5 h-5" />
        <span className="text-sm font-bold uppercase tracking-wider">Back</span>
      </button>

      <div className="relative z-10 w-full max-w-md">
        <div className="bg-black/80 border-2 border-stone-800 p-8 backdrop-blur-sm">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <div className="bg-red-600/10 p-4 border border-red-600/20">
                <Lock className="w-8 h-8 text-red-500" />
              </div>
            </div>
            <h2 className="text-2xl md:text-3xl font-black uppercase mb-2">
              <GlitchText text="RESET PASSWORD" />
            </h2>
            <p className="text-stone-500 text-sm">
              {error ? 'Enter a new password to continue' : 'Set your new password'}
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-400">{error}</div>
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/20 flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-sm text-emerald-400 font-bold">Password updated successfully!</div>
                <div className="text-xs text-emerald-500 mt-1">Redirecting to login...</div>
              </div>
            </div>
          )}

          {/* Reset Password Form */}
          {!success && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              {/* New Password Field */}
              <div>
                <label className="block text-xs text-stone-500 mb-2 font-bold">
                  New Password (min 6 characters)
                </label>
                <div className="relative">
                  <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-600" />
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••••••"
                    required
                    minLength={6}
                    disabled={loading}
                    className="w-full bg-black/50 border border-stone-800 rounded pl-10 pr-4 py-3 text-white placeholder:text-stone-700 focus:border-red-600 focus:outline-none transition-colors disabled:opacity-50"
                  />
                </div>
              </div>

              {/* Confirm Password Field */}
              <div>
                <label className="block text-xs text-stone-500 mb-2 font-bold">
                  Confirm New Password
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

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-red-600 hover:bg-red-500 disabled:bg-stone-800 disabled:cursor-not-allowed text-white font-bold py-3 px-4 uppercase tracking-wider transition-colors relative overflow-hidden group"
              >
                <span className="relative z-10">
                  {loading ? 'UPDATING...' : 'UPDATE PASSWORD'}
                </span>
                <div className="absolute inset-0 bg-red-500 translate-x-full group-hover:translate-x-0 transition-transform duration-200"></div>
              </button>
            </form>
          )}

          {/* Additional Info */}
          <div className="mt-6 pt-6 border-t border-stone-800">
            <div className="flex items-center justify-between text-xs">
              <span className="text-stone-600">SYSTEM ONLINE</span>
              <button
                onClick={handleBack}
                className="text-stone-500 hover:text-white transition-colors uppercase tracking-wider"
              >
                Back to Login
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResetPasswordPage;

