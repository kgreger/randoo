import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MAX_SKIP_PCT, routeEndsFromUser } from "../lib/routeEnds";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/useAuth";

// Two percentages, start and end, saved on the account when a field is left
// or Enter is pressed.
export function RouteEndsPicker() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const current = routeEndsFromUser(user?.user_metadata);
  const [start, setStart] = useState(String(current.startPct));
  const [end, setEnd] = useState(String(current.endPct));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  // The account's values arrive after the first render, see AccountDialog.
  useEffect(() => {
    setStart(String(current.startPct));
    setEnd(String(current.endPct));
  }, [current.startPct, current.endPct]);

  function parse(value: string): number | null {
    const number = Number(value.replace(",", "."));
    return value.trim() !== "" && Number.isFinite(number) && number >= 0 && number <= MAX_SKIP_PCT ? number : null;
  }

  async function save() {
    const startPct = parse(start);
    const endPct = parse(end);
    setSaved(false);
    setError(false);
    if (startPct === null || endPct === null) {
      setError(true);
      return;
    }
    if (!supabase || (startPct === current.startPct && endPct === current.endPct)) return;
    const { error: updateError } = await supabase.auth.updateUser({
      data: { skip_start_pct: startPct, skip_end_pct: endPct },
    });
    if (updateError) setError(true);
    else setSaved(true);
  }

  function field(label: string, value: string, onChange: (value: string) => void) {
    return (
      <label className="route-ends-field">
        <span>{label}</span>
        <input
          className="field-input"
          type="number"
          inputMode="decimal"
          min={0}
          max={MAX_SKIP_PCT}
          step={1}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setSaved(false);
            setError(false);
          }}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
        <span className="route-ends-unit">%</span>
      </label>
    );
  }

  return (
    <>
      <div className="route-ends">
        {field(t("routeEnds.start"), start, setStart)}
        {field(t("routeEnds.end"), end, setEnd)}
      </div>
      {saved && <p className="account-success">{t("routeEnds.saved")}</p>}
      {error && <p className="account-error">{t("routeEnds.error", { max: MAX_SKIP_PCT })}</p>}
    </>
  );
}
