import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DEVICE_MAKES, OTHER, deviceFromUser } from "../lib/devices";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/useAuth";

// Two dropdowns in steps: the make first, then only that make's models. The
// choice is saved on the account as soon as it changes.
export function DevicePicker() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { make, model } = deviceFromUser(user?.user_metadata);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  const makeInfo = DEVICE_MAKES.find((m) => m.id === make);

  async function save(nextMake: string, nextModel: string) {
    if (!supabase) return;
    setSaved(false);
    setError(false);
    const { error: updateError } = await supabase.auth.updateUser({
      data: { device_make: nextMake, device_model: nextModel },
    });
    if (updateError) setError(true);
    else setSaved(true);
  }

  function selectMake(nextMake: string) {
    const info = DEVICE_MAKES.find((m) => m.id === nextMake);
    // A make without models of its own has only "other" to offer, so that is
    // the model right away.
    save(nextMake, info && info.models.length === 0 ? OTHER : "");
  }

  return (
    <>
      <select className="field-input" value={make} onChange={(e) => selectMake(e.target.value)} aria-label={t("device.make")}>
        <option value="">{t("device.notSet")}</option>
        {DEVICE_MAKES.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name ?? t("device.other")}
          </option>
        ))}
      </select>
      {makeInfo && (
        <select
          className="field-input"
          value={model}
          onChange={(e) => save(make, e.target.value)}
          aria-label={t("device.model")}
        >
          {makeInfo.models.length > 0 && <option value="">{t("device.notSet")}</option>}
          {makeInfo.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
          <option value={OTHER}>{t("device.other")}</option>
        </select>
      )}
      {saved && <p className="account-success">{t("device.saved")}</p>}
      {error && <p className="account-error">{t("device.error")}</p>}
    </>
  );
}
