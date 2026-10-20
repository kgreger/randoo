import { useTranslation } from "react-i18next";

const IMPRINT_URL = "https://konstantingreger.net/impressum";
const PRIVACY_URL = "https://konstantingreger.net/datenschutz";

export function LegalLinks() {
  const { t } = useTranslation();
  return (
    <footer className="legal-links">
      <a href={IMPRINT_URL} target="_blank" rel="noopener noreferrer">
        {t("legal.imprint")}
      </a>
      <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
        {t("legal.privacy")}
      </a>
    </footer>
  );
}
