import { useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/useAuth";

interface Props {
  onClose: () => void;
}

export function DeleteAccountDialog({ onClose }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [confirmEmail, setConfirmEmail] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = !!user?.email && confirmEmail.trim().toLowerCase() === user.email.toLowerCase();

  async function deleteAccount() {
    if (!supabase || !matches) return;
    setDeleting(true);
    setError(null);
    const { error: invokeError } = await supabase.functions.invoke("delete-account", {
      body: { confirm_email: confirmEmail.trim() },
    });
    if (invokeError) {
      setDeleting(false);
      setError(t("deleteAccount.error"));
      return;
    }
    // The account is already gone server-side, so only clear this browser's
    // session; a normal sign-out would ask the server about a missing user.
    await supabase.auth.signOut({ scope: "local" });
    onClose();
  }

  return (
    <div className="map-empty">
      <div className="map-empty-card signin-card">
        <button className="dialog-close" onClick={onClose} aria-label={t("account.close")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <h2 className="delete-account-title">{t("deleteAccount.title")}</h2>
        <p className="delete-account-text">{t("deleteAccount.description")}</p>

        <div className="account-field-group">
          <label className="account-field-label">{t("deleteAccount.confirmLabel")}</label>
          <p className="delete-account-email">{user?.email}</p>
          <input
            className="field-input"
            type="email"
            autoComplete="off"
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && deleteAccount()}
          />
          <button className="btn btn-danger" onClick={deleteAccount} disabled={!matches || deleting}>
            {deleting ? t("deleteAccount.deleting") : t("deleteAccount.button")}
          </button>
          {error && <p className="account-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
