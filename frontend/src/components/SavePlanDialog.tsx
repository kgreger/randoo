import { useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Props {
  defaultName: string;
  // Set when the current results came from a saved plan, which can then be
  // overwritten instead of saved next to.
  openPlanName: string | null;
  onSave: (name: string, asNew: boolean) => Promise<void>;
  onClose: () => void;
}

export function SavePlanDialog({ defaultName, openPlanName, onSave, onClose }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(openPlanName ?? defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(asNew: boolean) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(trimmed, asNew);
    } catch (err) {
      console.error("Saving the plan failed", err);
      setBusy(false);
      const message = err instanceof Error ? err.message : "";
      setError(message.includes("limit reached") ? t("plans.errorLimit") : t("plans.errorSave"));
    }
  }

  return (
    <div className="map-empty">
      <div className="map-empty-card signin-card">
        <button className="dialog-close" onClick={onClose} aria-label={t("account.close")}>
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>

        <div className="account-field-group">
          <label className="account-field-label" htmlFor="plan-name">
            {t("plans.nameLabel")}
          </label>
          <input
            id="plan-name"
            className="field-input"
            type="text"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit(!openPlanName)}
            autoFocus
          />
          {openPlanName ? (
            <>
              <button className="btn btn-primary" onClick={() => submit(false)} disabled={busy || !name.trim()}>
                {busy ? t("account.saving") : t("plans.update")}
              </button>
              <button className="btn btn-ghost" onClick={() => submit(true)} disabled={busy || !name.trim()}>
                {t("plans.saveAsNew")}
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => submit(true)} disabled={busy || !name.trim()}>
              {busy ? t("account.saving") : t("plans.save")}
            </button>
          )}
          {error && <p className="account-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
