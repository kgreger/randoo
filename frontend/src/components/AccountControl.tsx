import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/useAuth";

export function AccountControl() {
  const { user, loading, enabled } = useAuth();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!enabled || loading) return null;

  async function sendMagicLink() {
    if (!supabase || !email) return;
    setError(null);
    const { error: authError } = await supabase.auth.signInWithOtp({ email });
    if (authError) setError(authError.message);
    else setSent(true);
  }

  async function signOut() {
    await supabase?.auth.signOut();
    setOpen(false);
  }

  if (user) {
    return (
      <div className="account-control">
        <button className="btn btn-ghost" onClick={signOut}>
          {user.email}
        </button>
      </div>
    );
  }

  return (
    <div className="account-control">
      <button className="btn btn-ghost" onClick={() => setOpen((v) => !v)}>
        Sign in
      </button>
      {open && (
        <div className="account-popover">
          {sent ? (
            <p>Check your inbox for a sign-in link.</p>
          ) : (
            <>
              <p>Sign in to save routes and presets.</p>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button className="btn btn-primary" onClick={sendMagicLink} disabled={!email}>
                Send sign-in link
              </button>
              {error && <p className="account-error">{error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
