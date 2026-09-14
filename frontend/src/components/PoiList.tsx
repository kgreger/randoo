import type { Poi } from "../lib/api";
import { CATEGORIES } from "../lib/categories";

interface Props {
  pois: Poi[];
  radiusM: number;
  excludedIds: Set<string>;
  onToggleExcluded: (id: string) => void;
}

function categoryLabel(id: string): string {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

export function PoiList({ pois, radiusM, excludedIds, onToggleExcluded }: Props) {
  const includedCount = pois.length - excludedIds.size;

  return (
    <div className="side-panel">
      <div className="side-panel-head">
        <h2>Nearby points</h2>
        {pois.length > 0 && (
          <span className="count">
            {includedCount < pois.length ? `${includedCount}/${pois.length}` : pois.length}
          </span>
        )}
      </div>
      <div className="poi-list">
        {pois.length === 0 && (
          <div className="empty-state">Points along your route will show up here.</div>
        )}
        {pois.map((poi, index) => {
          const excluded = excludedIds.has(poi.id);
          // How far out this POI sits within the search radius itself, not
          // just its raw distance - a bar reads at a glance, a number needs
          // the radius held in your head to mean anything.
          const fillPct = Math.min(100, (poi.distance_to_route_m / radiusM) * 100);

          return (
            <label
              className={`poi-card ${index === 0 ? "nearest" : ""} ${excluded ? "excluded" : ""}`}
              key={poi.id}
            >
              <input
                type="checkbox"
                className="poi-card-check"
                checked={!excluded}
                onChange={() => onToggleExcluded(poi.id)}
              />
              <div className="badge">{categoryLabel(poi.category_id).slice(0, 2)}</div>
              <div className="poi-card-body">
                <div className="name">{poi.name ?? categoryLabel(poi.category_id)}</div>
                <div className="meta">
                  {Math.round(poi.distance_to_route_m)} m, {categoryLabel(poi.category_id)}
                </div>
                <div className="distance-bar" title={`${Math.round(poi.distance_to_route_m)} m of ${radiusM} m radius`}>
                  <div className="distance-bar-fill" style={{ width: `${fillPct}%` }} />
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
