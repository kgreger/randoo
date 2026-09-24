import { useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("magic");
  const [passwordView, setPasswordView] = useState<PasswordView>("signin");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

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
          <p>{t("signInDialog.recoveryPrompt")}</p>
          <input
            className="field-input"
            type="password"
            placeholder={t("signInDialog.newPasswordPlaceholder")}
            value={newPassword}
            autoFocus
            onChange={(e) => setNewPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveNewPassword()}
          />
          <button className="btn btn-primary" onClick={saveNewPassword} disabled={!newPassword || sending}>
            {sending ? t("signInDialog.saving") : t("signInDialog.savePassword")}
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
      options: {
        emailRedirectTo: REDIRECT_URL,
        data: displayName.trim() ? { display_name: displayName.trim() } : undefined,
      },
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
        <button className="dialog-close" onClick={onClose} aria-label={t("signInDialog.close")}>
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
            {t("signInDialog.magicLink")}
          </button>
          <button
            className={`dialog-tab ${tab === "password" ? "active" : ""}`}
            onClick={() => {
              setTab("password");
              setError(null);
            }}
          >
            {t("signInDialog.password")}
          </button>
        </div>

        {tab === "magic" &&
          (magicLinkSent ? (
            <p>{t("signInDialog.magicLinkSent")}</p>
          ) : (
            <>
              <p>{t("signInDialog.magicLinkPrompt")}</p>
              <input
                className="field-input"
                type="email"
                placeholder={t("signInDialog.emailPlaceholder")}
                value={email}
                autoFocus
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMagicLink()}
              />
              <button className="btn btn-primary" onClick={sendMagicLink} disabled={!email || sending}>
                {sending ? t("signInDialog.sending") : t("signInDialog.sendMagicLink")}
              </button>
              <ErrorText message={error} />
            </>
          ))}

        {tab === "password" && passwordView === "signin" && (
          <>
            <p>{t("signInDialog.passwordSignInPrompt")}</p>
            <input
              className="field-input"
              type="email"
              placeholder={t("signInDialog.emailPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="field-input"
              type="password"
              placeholder={t("signInDialog.passwordPlaceholder")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && signInWithPassword()}
            />
            <button
              className="btn btn-primary"
              onClick={signInWithPassword}
              disabled={!email || !password || sending}
            >
              {sending ? t("signInDialog.signingIn") : t("signInDialog.signIn")}
            </button>
            <ErrorText message={error} />
            <div className="dialog-links">
              <button className="link-button" onClick={() => setPasswordView("signup")}>
                {t("signInDialog.createAccount")}
              </button>
              <button className="link-button" onClick={() => setPasswordView("forgot")}>
                {t("signInDialog.forgotPassword")}
              </button>
            </div>
          </>
        )}

        {tab === "password" && passwordView === "signup" && (
          <>
            {signupPending ? (
              <p>{t("signInDialog.signupPending")}</p>
            ) : (
              <>
                <p>{t("signInDialog.signupPrompt")}</p>
                <input
                  className="field-input"
                  type="text"
                  placeholder={t("signInDialog.displayNamePlaceholder")}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
                <input
                  className="field-input"
                  type="email"
                  placeholder={t("signInDialog.emailPlaceholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <input
                  className="field-input"
                  type="password"
                  placeholder={t("signInDialog.passwordMinPlaceholder")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  className="btn btn-primary"
                  onClick={signUpWithPassword}
                  disabled={!email || !password || sending}
                >
                  {sending ? t("signInDialog.creating") : t("signInDialog.createAccountButton")}
                </button>
                <ErrorText message={error} />
              </>
            )}
            <div className="dialog-links">
              <button className="link-button" onClick={() => setPasswordView("signin")}>
                {t("signInDialog.alreadyHaveAccount")}
              </button>
            </div>
          </>
        )}

        {tab === "password" && passwordView === "forgot" && (
          <>
            {resetSent ? (
              <p>{t("signInDialog.resetSent")}</p>
            ) : (
              <>
                <p>{t("signInDialog.resetPrompt")}</p>
                <input
                  className="field-input"
                  type="email"
                  placeholder={t("signInDialog.emailPlaceholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button className="btn btn-primary" onClick={sendPasswordReset} disabled={!email || sending}>
                  {sending ? t("signInDialog.sending") : t("signInDialog.sendResetLink")}
                </button>
                <ErrorText message={error} />
              </>
            )}
            <div className="dialog-links">
              <button className="link-button" onClick={() => setPasswordView("signin")}>
                {t("signInDialog.backToSignIn")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
