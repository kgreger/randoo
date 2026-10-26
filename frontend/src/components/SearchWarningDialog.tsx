import { useTranslation } from "react-i18next";

interface Props {
  dropped: { categoryId: string; count: number }[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function SearchWarningDialog({ dropped, onConfirm, onCancel }: Props) {
  const { t } = useTranslation();
  const list = dropped.map(({ categoryId, count }) => `${t(`categories.${categoryId}`)} (${count})`).join(", ");

  return (
    <div className="map-empty">
      <div className="map-empty-card signin-card">
        <div className="account-field-group">
          <p className="search-warning-text">{t("searchWarning.text", { categories: list })}</p>
          <p className="account-hint">{t("searchWarning.hint")}</p>
          <button className="btn btn-primary" onClick={onConfirm}>
            {t("searchWarning.confirm")}
          </button>
          <button className="btn btn-ghost" onClick={onCancel}>
            {t("searchWarning.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
