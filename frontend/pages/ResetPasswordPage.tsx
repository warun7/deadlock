import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { supabase } from "../lib/supabase";
import AuthLayout from "../components/app/AuthLayout";
import Field from "../components/ui/Field";
import { Button } from "../components/ui/Button";

const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Recovery errors arrive in the URL hash
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.substring(1));
    const errorParam = params.get("error");
    const errorDescription = params.get("error_description");
    if (errorParam) {
      console.error("Password reset error:", errorParam, errorDescription);
      if (errorDescription?.includes("expired")) {
        setError("This reset link has expired. Request a new one from the log in page.");
      } else if (errorDescription?.includes("invalid")) {
        setError("This reset link is invalid. Request a new one from the log in page.");
      } else {
        setError("This reset link did not work. Request a new one from the log in page.");
      }
    }
  }, []);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      setLoading(false);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      setLoading(false);
      return;
    }

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        setError(updateError.message);
        setLoading(false);
      } else {
        setSuccess(true);
        setTimeout(() => navigate("/auth"), 2000);
      }
    } catch (err: any) {
      setError(err.message || "Something went wrong while resetting your password.");
      setLoading(false);
    }
  };

  return (
    <AuthLayout backTo="/auth" backLabel="Log in">
      <h1 className="text-3xl font-semibold tracking-[-0.03em] text-fg">Set a new password</h1>
      <p className="mt-2 text-[15px] text-fg-2">Choose something you have not used here before.</p>

      {success ? (
        <div role="status" className="mt-8 flex items-start gap-2.5 rounded-[var(--radius-control)] bg-pass/10 px-3.5 py-3 text-sm text-pass">
          <CheckCircle className="mt-0.5 size-4 shrink-0" weight="bold" />
          <span>Password updated. Taking you to log in.</span>
        </div>
      ) : (
        <form onSubmit={handleResetPassword} className="mt-8 space-y-5">
          <Field
            label="New password"
            type="password"
            autoComplete="new-password"
            hint="At least 6 characters."
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={6}
            disabled={loading}
            autoFocus
          />
          <Field
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={6}
            disabled={loading}
            error={confirmPassword && newPassword !== confirmPassword ? "Passwords do not match." : null}
          />
          {error && (
            <div role="alert" className="flex items-start gap-2.5 rounded-[var(--radius-control)] bg-accent/10 px-3.5 py-3 text-sm text-accent-text">
              <WarningCircle className="mt-0.5 size-4 shrink-0" weight="bold" />
              <span>{error}</span>
            </div>
          )}
          <Button type="submit" size="lg" loading={loading} className="w-full">
            {loading ? "Updating" : "Update password"}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
};

export default ResetPasswordPage;
