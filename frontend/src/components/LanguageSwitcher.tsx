import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "../i18n";

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const current = (i18n.resolvedLanguage ?? "en") as SupportedLanguage;

  return (
    <div className="language-switcher" role="group" aria-label={t("language.label")}>
      {SUPPORTED_LANGUAGES.map((lang) => (
        <button
          key={lang}
          type="button"
          className={`language-switcher-option ${lang === current ? "active" : ""}`}
          onClick={() => i18n.changeLanguage(lang)}
          aria-pressed={lang === current}
        >
          {lang.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
