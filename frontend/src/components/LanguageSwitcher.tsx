import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "../i18n";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/useAuth";

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const current = (i18n.resolvedLanguage ?? "en") as SupportedLanguage;

  function selectLanguage(lang: SupportedLanguage) {
    i18n.changeLanguage(lang);
    // Persisted to the account, not just this browser's storage, so it
    // follows a signed-in rider to their next device too - same pattern as
    // display_name elsewhere in AccountDialog. App.tsx reads it back on
    // sign-in.
    if (user) supabase?.auth.updateUser({ data: { language: lang } });
  }

  return (
    <div className="language-switcher" role="group" aria-label={t("language.label")}>
      {SUPPORTED_LANGUAGES.map((lang) => (
        <button
          key={lang}
          type="button"
          className={`language-switcher-option ${lang === current ? "active" : ""}`}
          onClick={() => selectLanguage(lang)}
          aria-pressed={lang === current}
        >
          {lang.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
