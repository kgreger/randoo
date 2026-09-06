import { CATEGORIES } from "../lib/categories";

interface Props {
  selected: Set<string>;
  onToggle: (id: string) => void;
  radiusM: number;
  onRadiusChange: (value: number) => void;
}

export function CategoryFilter({ selected, onToggle, radiusM, onRadiusChange }: Props) {
  return (
    <>
      <div>
        <div className="section-label">Categories</div>
        <div className="chip-row">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={`chip ${selected.has(cat.id) ? "active" : ""}`}
              onClick={() => onToggle(cat.id)}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>
      <div className="radius-row">
        <label>
          <span>Radius</span>
          <span className="value">{radiusM} m</span>
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
