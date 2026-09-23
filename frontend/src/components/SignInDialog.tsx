import { useState } from "react";
import { supabase } from "../lib/supabase";

interface Props {
  onClose: () => void;
  recoveryMode: boolean;
  onRecoveryDone: () => void;
}

type Tab = "magic" | "password";
type PasswordView = "signin" | "signup" | "forgot";

// window.location.origin alone is just the bare domain - wrong once the
// app is served under a path prefix (see vite.config.ts's `base`), which
// BASE_URL already reflects in both dev ("/") and prod ("/randoo/").
const REDIRECT_URL = window.location.origin + import.meta.env.BASE_URL;

function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="account-error">{message}</p>;
}

export function SignInDialog({ onClose, recoveryMode, onRecoveryDone }: Props) {
  const [tab, setTab] = useState<Tab>("magic");
  const [passwordView, setPasswordView] = useState<PasswordView>("signin");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [signupPending, setSignupPending] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  if (recoveryMode) {
    async function saveNewPassword() {
      if (!supabase || !newPassword) return;
      setSending(true);
      setError(null);
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      setSending(false);
      if (updateError) setError(updateError.message);
      else onRecoveryDone();
    }

    return (
      <div className="map-empty">
        <div className="map-empty-card signin-card">
          <p>Choose a new password for your account.</p>
          <input
            className="field-input"
            type="password"
            placeholder="New password"
            value={newPassword}
            autoFocus
            onChange={(e) => setNewPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveNewPassword()}
          />
          <button className="btn btn-primary" onClick={saveNewPassword} disabled={!newPassword || sending}>
            {sending ? "Saving…" : "Save password"}
          </button>
          <ErrorText message={error} />
        </div>
      </div>
    );
  }

  async function sendMagicLink() {
    if (!supabase || !email) return;
    setSending(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithOtp({ email });
    setSending(false);
    if (authError) setError(authError.message);
    else setMagicLinkSent(true);
  }

  async function signInWithPassword() {
    if (!supabase || !email || !password) return;
    setSending(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    setSending(false);
    if (authError) setError(authError.message);
    // success closes the dialog itself, via the parent watching for a session
  }

  async function signUpWithPassword() {
    if (!supabase || !email || !password) return;
    setSending(true);
    setError(null);
    const { data, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: REDIRECT_URL },
    });
    setSending(false);
    if (authError) setError(authError.message);
    else if (!data.session) setSignupPending(true);
  }

  async function sendPasswordReset() {
    if (!supabase || !email) return;
    setSending(true);
    setError(null);
    const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: REDIRECT_URL,
    });
    setSending(false);
    if (authError) setError(authError.message);
    else setResetSent(true);
  }

  return (
    <div className="map-empty">
      <div className="map-empty-card signin-card">
        <button className="dialog-close" onClick={onClose} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div className="dialog-tabs">
          <button
            className={`dialog-tab ${tab === "magic" ? "active" : ""}`}
            onClick={() => {
              setTab("magic");
              setError(null);
            }}
          >
            Magic link
          </button>
          <button
            className={`dialog-tab ${tab === "password" ? "active" : ""}`}
            onClick={() => {
              setTab("password");
              setError(null);
            }}
          >
            Password
          </button>
        </div>

        {tab === "magic" &&
          (magicLinkSent ? (
            <p>Check your inbox for a sign-in link.</p>
          ) : (
            <>
              <p>No password needed, we'll email you a link.</p>
              <input
                className="field-input"
                type="email"
                placeholder="you@example.com"
                value={email}
                autoFocus
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMagicLink()}
              />
              <button className="btn btn-primary" onClick={sendMagicLink} disabled={!email || sending}>
                {sending ? "Sending…" : "Send sign-in link"}
              </button>
              <ErrorText message={error} />
            </>
          ))}

        {tab === "password" && passwordView === "signin" && (
          <>
            <p>Sign in with your email and password.</p>
            <input
              className="field-input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="field-input"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && signInWithPassword()}
            />
            <button
              className="btn btn-primary"
              onClick={signInWithPassword}
              disabled={!email || !password || sending}
            >
              {sending ? "Signing in…" : "Sign in"}
            </button>
            <ErrorText message={error} />
            <div className="dialog-links">
              <button className="link-button" onClick={() => setPasswordView("signup")}>
                Create an account
              </button>
              <button className="link-button" onClick={() => setPasswordView("forgot")}>
                Forgot password?
              </button>
            </div>
          </>
        )}

        {tab === "password" && passwordView === "signup" && (
          <>
            {signupPending ? (
              <p>Check your inbox to confirm your account.</p>
            ) : (
              <>
                <p>Create an account with an email and password.</p>
                <input
                  className="field-input"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <input
                  className="field-input"
                  type="password"
                  placeholder="Password (min. 6 characters)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  className="btn btn-primary"
                  onClick={signUpWithPassword}
                  disabled={!email || !password || sending}
                >
                  {sending ? "Creating…" : "Create account"}
                </button>
                <ErrorText message={error} />
              </>
            )}
            <div className="dialog-links">
              <button className="link-button" onClick={() => setPasswordView("signin")}>
                Already have an account? Sign in
              </button>
            </div>
          </>
        )}

        {tab === "password" && passwordView === "forgot" && (
          <>
            {resetSent ? (
              <p>Check your inbox for a password reset link.</p>
            ) : (
              <>
                <p>We'll email you a link to reset your password.</p>
                <input
                  className="field-input"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button className="btn btn-primary" onClick={sendPasswordReset} disabled={!email || sending}>
                  {sending ? "Sending…" : "Send reset link"}
                </button>
                <ErrorText message={error} />
              </>
            )}
            <div className="dialog-links">
              <button className="link-button" onClick={() => setPasswordView("signin")}>
                Back to sign in
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
