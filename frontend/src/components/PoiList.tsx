import type { Poi } from "../lib/api";
import { CATEGORIES } from "../lib/categories";

interface Props {
  pois: Poi[];
}

function categoryLabel(id: string): string {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

export function PoiList({ pois }: Props) {
  return (
    <div className="side-panel">
      <div className="side-panel-head">
        <h2>Nearby points</h2>
        {pois.length > 0 && <span className="count">{pois.length}</span>}
      </div>
      <div className="poi-list">
        {pois.length === 0 && (
          <div className="empty-state">Points along your route will show up here.</div>
        )}
        {pois.map((poi) => (
          <div className="poi-card" key={`${poi.osm_type}-${poi.osm_id}`}>
            <div className="badge">{categoryLabel(poi.category_id).slice(0, 2)}</div>
            <div>
              <div className="name">{poi.name ?? categoryLabel(poi.category_id)}</div>
              <div className="meta">
                {Math.round(poi.distance_to_route_m)} m · {categoryLabel(poi.category_id)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
