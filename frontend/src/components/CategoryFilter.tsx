import { useTranslation } from "react-i18next";
import { CATEGORIES } from "../lib/categories";

interface Props {
  selected: Set<string>;
  onToggle: (id: string) => void;
  radiusM: number;
  onRadiusChange: (value: number) => void;
}

const RING_RADIUS = 24;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function CategoryFilter({ selected, onToggle, radiusM, onRadiusChange }: Props) {
  const { t } = useTranslation();
  const active = selected.size;
  const total = CATEGORIES.length;
  const filled = RING_CIRCUMFERENCE * (active / total);

  return (
    <>
      <div className="category-ring">
        <svg width="58" height="58" viewBox="0 0 58 58" style={{ flex: "none" }}>
          <circle cx="29" cy="29" r={RING_RADIUS} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="6" />
          <circle
            cx="29"
            cy="29"
            r={RING_RADIUS}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${RING_CIRCUMFERENCE - filled}`}
            transform="rotate(-90 29 29)"
          />
          <text x="29" y="34" textAnchor="middle" fontFamily="Onest" fontWeight="700" fontSize="15" fill="var(--ink)">
            {active}/{total}
          </text>
        </svg>
        <div>
          <div className="label">{t("categories.active")}</div>
          <div className="sub">{t("categories.selectedCount", { active, total })}</div>
        </div>
      </div>

      <div>
        <div className="section-label">{t("categories.sectionLabel")}</div>
        <div className="chip-row">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={`chip ${selected.has(cat.id) ? "active" : ""}`}
              onClick={() => onToggle(cat.id)}
            >
              {t(`categories.${cat.id}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="radius-row">
        <label>
          <span>{t("categories.radius")}</span>
          <span className="value">{t("categories.radiusValue", { value: radiusM })}</span>
        </label>
        <input
          type="range"
          min={100}
          max={2000}
          step={100}
          value={radiusM}
          onChange={(e) => onRadiusChange(Number(e.target.value))}
        />
      </div>
    </>
  );
}
