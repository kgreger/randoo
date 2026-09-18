import { Fragment, useEffect, useRef } from "react";
import type { Poi } from "../lib/api";
import { categoryById } from "../lib/categories";

interface Props {
  pois: Poi[];
  radiusM: number;
  excludedIds: Set<string>;
  selectedId: string | null;
  onToggleExcluded: (id: string) => void;
  onFocusPoi: (poi: Poi) => void;
  onHoverPoi: (id: string | null) => void;
}

// Below this, two POIs read as "basically together" - not worth a gap marker
// of their own on top of the cards' own spacing.
const GAP_THRESHOLD_M = 300;
const GAP_MIN_PX = 20;
const GAP_MAX_PX = 72;
// Distance at which a gap has earned the full visual weight - a sparser
// touring route routinely has stretches well past this, and past it, more
// distance doesn't need to read as "even more of a gap": it's already
// unmistakably a long one.
const GAP_SCALE_MAX_M = 100_000;

function formatGap(gapM: number): string {
  return gapM >= 1000 ? `${(gapM / 1000).toFixed(1)} km` : `${Math.round(gapM)} m`;
}

// Log, not linear or sqrt, because the gaps worth marking span a huge range
// (300 m to well over 100 km) and a rider reads them as orders of magnitude,
// not raw meters: "noticeably further" should look the same whether it's 2km
// vs 1km or 40km vs 20km. A gentler curve saturates by ~10km, which on a
// sparse route crowds most real gaps up against the cap - they all end up
// reading as "big", with only noise-level pixel differences between a 15km
// and a 90km stretch.
function gapHeightPx(gapM: number): number {
  const t = Math.log(gapM / GAP_THRESHOLD_M) / Math.log(GAP_SCALE_MAX_M / GAP_THRESHOLD_M);
  return GAP_MIN_PX + (GAP_MAX_PX - GAP_MIN_PX) * Math.min(1, Math.max(0, t));
}

export function PoiList({
  pois,
  radiusM,
  excludedIds,
  selectedId,
  onToggleExcluded,
  onFocusPoi,
  onHoverPoi,
}: Props) {
  const includedCount = pois.length - excludedIds.size;
  const listRef = useRef<HTMLDivElement>(null);

  // Clicking a marker on the map selects it here too (see MapView's
  // onSelectPoi) - scrolling it into view is what makes that selection
  // actually visible instead of happening off-screen in a long list.
  useEffect(() => {
    if (!selectedId) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-poi-id="${CSS.escape(selectedId)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedId]);

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
      <div className="poi-list" ref={listRef}>
        {pois.length === 0 && (
          <div className="empty-state">Points along your route will show up here.</div>
        )}
        {pois.map((poi, index) => {
          const excluded = excludedIds.has(poi.id);
          const cat = categoryById(poi.category_id);
          const Icon = cat?.icon;
          // How far out this POI sits within the search radius itself, not
          // just its raw distance - a bar reads at a glance, a number needs
          // the radius held in your head to mean anything.
          const fillPct = Math.min(100, (poi.distance_to_route_m / radiusM) * 100);

          // A stretch of route with nothing found reads as empty scroll
          // space otherwise - a stop on this line, then a long stretch of
          // track, then the next stop, like a schematic transit map.
          const gapM = index > 0 ? poi.distance_along_route_m - pois[index - 1].distance_along_route_m : 0;
          const showGap = gapM >= GAP_THRESHOLD_M;
          const gapHeight = showGap ? gapHeightPx(gapM) : 0;

          return (
            <Fragment key={poi.id}>
              {showGap && (
                <div className="poi-gap" style={{ height: `${gapHeight}px` }}>
                  <div className="poi-gap-line" />
                  <span className="poi-gap-label">{formatGap(gapM)}</span>
                </div>
              )}
              <div
                className={`poi-card ${excluded ? "excluded" : ""} ${poi.id === selectedId ? "selected" : ""}`}
                data-poi-id={poi.id}
                // Clicking the card focuses it on the map - the checkbox
                // below stops this from firing so ticking it doesn't also
                // recenter.
                onClick={() => onFocusPoi(poi)}
                onMouseEnter={() => onHoverPoi(poi.id)}
                onMouseLeave={() => onHoverPoi(null)}
              >
                <label className="poi-card-check-wrap" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="poi-card-check"
                    checked={!excluded}
                    onChange={() => onToggleExcluded(poi.id)}
                  />
                </label>
                <div className="badge" title={cat?.label ?? poi.category_id}>
                  {Icon ? <Icon size={17} strokeWidth={2} aria-hidden="true" /> : cat?.label.slice(0, 2)}
                </div>
                <div className="poi-card-body">
                  <div className="name">{poi.name ?? cat?.label ?? poi.category_id}</div>
                  <div className="meta">
                    km {(poi.distance_along_route_m / 1000).toFixed(1)}, {Math.round(poi.distance_to_route_m)} m
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
