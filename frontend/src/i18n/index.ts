import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import de from "./locales/de.json";

export const SUPPORTED_LANGUAGES = ["en", "de"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, de: { translation: de } },
    supportedLngs: SUPPORTED_LANGUAGES,
    fallbackLng: "en",
    // A rider's own explicit pick (once made) always wins over the browser
    // locale on every later visit - only checked first if there's nothing
    // in storage yet, which is what leaves the initial pick up to the
    // browser's own language.
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "randoo-language",
      caches: ["localStorage"],
    },
    interpolation: { escapeValue: false },
  });

export default i18n;
