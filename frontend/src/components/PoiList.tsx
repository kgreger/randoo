import { Fragment } from "react";
import type { Poi } from "../lib/api";
import { CATEGORIES } from "../lib/categories";

interface Props {
  pois: Poi[];
  radiusM: number;
  excludedIds: Set<string>;
  onToggleExcluded: (id: string) => void;
  onFocusPoi: (poi: Poi) => void;
}

function category(id: string) {
  return CATEGORIES.find((c) => c.id === id);
}

// Below this, two POIs read as "basically together" - not worth a gap marker
// of their own on top of the cards' own spacing.
const GAP_THRESHOLD_M = 300;
const GAP_MIN_PX = 20;
const GAP_MAX_PX = 72;

function formatGap(gapM: number): string {
  return gapM >= 1000 ? `${(gapM / 1000).toFixed(1)} km` : `${Math.round(gapM)} m`;
}

export function PoiList({ pois, radiusM, excludedIds, onToggleExcluded, onFocusPoi }: Props) {
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
          const cat = category(poi.category_id);
          const Icon = cat?.icon;
          // How far out this POI sits within the search radius itself, not
          // just its raw distance - a bar reads at a glance, a number needs
          // the radius held in your head to mean anything.
          const fillPct = Math.min(100, (poi.distance_to_route_m / radiusM) * 100);

          // A stretch of route with nothing found reads as empty scroll
          // space otherwise - a stop on this line, then a long stretch of
          // track, then the next stop, like a schematic transit map. Scaled
          // by the square root of the gap so one 190 km outlier doesn't
          // push everything else off screen, just visibly further than a
          // 2 km one.
          const gapM = index > 0 ? poi.distance_along_route_m - pois[index - 1].distance_along_route_m : 0;
          const showGap = gapM >= GAP_THRESHOLD_M;
          const gapHeight = showGap
            ? Math.min(GAP_MAX_PX, GAP_MIN_PX + Math.sqrt(gapM / 1000) * 16)
            : 0;

          return (
            <Fragment key={poi.id}>
              {showGap && (
                <div className="poi-gap" style={{ height: `${gapHeight}px` }}>
                  <div className="poi-gap-line" />
                  <span className="poi-gap-label">{formatGap(gapM)}</span>
                </div>
              )}
              <div
                className={`poi-card ${excluded ? "excluded" : ""}`}
                // Clicking the card focuses it on the map - the checkbox
                // below stops this from firing so ticking it doesn't also
                // recenter.
                onClick={() => onFocusPoi(poi)}
              >
                <label className="poi-card-check-wrap" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="poi-card-check"
                    checked={!excluded}
                    onChange={() => onToggleExcluded(poi.id)}
                  />
                </label>
                <div className="badge">
                  {Icon ? <Icon size={17} strokeWidth={2} aria-hidden="true" /> : cat?.label.slice(0, 2)}
                </div>
                <div className="poi-card-body">
                  <div className="name">{poi.name ?? cat?.label ?? poi.category_id}</div>
                  <div className="meta">
                    km {(poi.distance_along_route_m / 1000).toFixed(1)}, {Math.round(poi.distance_to_route_m)} m,{" "}
                    {cat?.label ?? poi.category_id}
                  </div>
                  <div
                    className="distance-bar"
                    title={`${Math.round(poi.distance_to_route_m)} m of ${radiusM} m radius`}
                  >
                    <div className="distance-bar-fill" style={{ width: `${fillPct}%` }} />
                  </div>
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
