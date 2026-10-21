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

// With a plan open, the dialog first asks whether to overwrite it or to save
// a new one; only the second step shows a name field, so a new plan is never
// saved under the open plan's name by accident.
export function SavePlanDialog({ defaultName, openPlanName, onSave, onClose }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState<"choose" | "name">(openPlanName ? "choose" : "name");
  const [name, setName] = useState(defaultName === openPlanName ? `${defaultName} (2)` : defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(trimmed: string, asNew: boolean) {
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
          {step === "choose" && openPlanName ? (
            <>
              <p className="plans-open-name">{t("plans.openPlan", { name: openPlanName })}</p>
              <button className="btn btn-primary" onClick={() => submit(openPlanName, false)} disabled={busy}>
                {busy ? t("account.saving") : t("plans.update")}
              </button>
              <button className="btn btn-ghost" onClick={() => setStep("name")} disabled={busy}>
                {t("plans.saveAsNew")}
              </button>
            </>
          ) : (
            <>
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
                onFocus={(e) => e.target.select()}
                onKeyDown={(e) => e.key === "Enter" && submit(name.trim(), true)}
                autoFocus
              />
              <button
                className="btn btn-primary"
                onClick={() => submit(name.trim(), true)}
                disabled={busy || !name.trim()}
              >
                {busy ? t("account.saving") : t("plans.save")}
              </button>
            </>
          )}
          {error && <p className="account-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
