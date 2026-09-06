import { useState } from "react";
import { supabase } from "../lib/supabase";

interface Props {
  onClose: () => void;
}

export function SignInDialog({ onClose }: Props) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendMagicLink() {
    if (!supabase || !email) return;
    setSending(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithOtp({ email });
    setSending(false);
    if (authError) setError(authError.message);
    else setSent(true);
  }

  return (
    <div className="map-empty">
      <div className="map-empty-card signin-card">
        <button className="dialog-close" onClick={onClose} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        {sent ? (
          <>
            <div className="icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffb35c" strokeWidth="1.8">
                <path d="M4 6h16v12H4z" />
                <path d="m4 7 8 6 8-6" />
              </svg>
            </div>
            <p>Check your inbox for a sign-in link.</p>
          </>
        ) : (
          <>
            <div className="icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffb35c" strokeWidth="1.8">
                <circle cx="12" cy="9" r="3.5" />
                <path d="M5 20c1.3-3.2 4-5 7-5s5.7 1.8 7 5" />
              </svg>
            </div>
            <p>Sign in to export your results — no password, just a link by email.</p>
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
            {error && <p className="account-error">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
