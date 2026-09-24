import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/useAuth";

interface Props {
  onClose: () => void;
}

function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="account-error">{message}</p>;
}

export function AccountDialog({ onClose }: Props) {
  const { user } = useAuth();
  const currentName = (user?.user_metadata?.display_name as string | undefined) ?? "";

  const [displayName, setDisplayName] = useState(currentName);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);

  // useAuth's user arrives asynchronously (it awaits getSession() on mount),
  // so the field's initial value above is usually still empty at first
  // render - this catches up once the real display name is in, and again
  // after a save confirms the new one actually took.
  useEffect(() => {
    setDisplayName(currentName);
  }, [currentName]);

  const [newPassword, setNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);

  async function saveDisplayName() {
    if (!supabase) return;
    setSavingName(true);
    setNameError(null);
    setNameSaved(false);
    const { error } = await supabase.auth.updateUser({ data: { display_name: displayName.trim() } });
    setSavingName(false);
    if (error) setNameError(error.message);
    else setNameSaved(true);
  }

  async function savePassword() {
    if (!supabase || !newPassword) return;
    setSavingPassword(true);
    setPasswordError(null);
    setPasswordSaved(false);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);
    if (error) setPasswordError(error.message);
    else {
      setPasswordSaved(true);
      setNewPassword("");
    }
  }

  return (
    <div className="map-empty">
      <div className="map-empty-card signin-card">
        <button className="dialog-close" onClick={onClose} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <p className="account-email">{user?.email}</p>

        <div className="account-field-group">
          <label className="account-field-label">Display name</label>
          <input
            className="field-input"
            type="text"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setNameSaved(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && saveDisplayName()}
          />
          <button
            className="btn btn-primary"
            onClick={saveDisplayName}
            disabled={savingName || displayName.trim() === currentName}
          >
            {savingName ? "Saving…" : "Save name"}
          </button>
          <ErrorText message={nameError} />
          {nameSaved && <p className="account-success">Display name updated.</p>}
        </div>

        <div className="account-field-group">
          <label className="account-field-label">New password</label>
          <input
            className="field-input"
            type="password"
            placeholder="Leave blank to keep current password"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              setPasswordSaved(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && savePassword()}
          />
          <button className="btn btn-primary" onClick={savePassword} disabled={savingPassword || !newPassword}>
            {savingPassword ? "Saving…" : "Update password"}
          </button>
          <ErrorText message={passwordError} />
          {passwordSaved && <p className="account-success">Password updated.</p>}
        </div>
      </div>
    </div>
  );
}
