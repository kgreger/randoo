import { Fragment, useEffect, useRef } from "react";
import { Eye, EyeOff, Flag } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { Poi } from "../lib/api";
import type { RouteWaypoint } from "../lib/gpxPreview";
import { categoryById } from "../lib/categories";
import { isStackedLayout } from "../lib/layout";

export type WaypointOnRoute = RouteWaypoint & { alongM: number; offM: number };

type Row =
  | { kind: "poi"; poi: Poi; along: number }
  | { kind: "waypoint"; waypoint: WaypointOnRoute; along: number };

interface Props {
  pois: Poi[];
  // Waypoints the loaded file already had, listed among the found points in
  // route order as reference marks.
  waypoints: WaypointOnRoute[];
  onFocusWaypoint: (waypoint: WaypointOnRoute) => void;
  radiusM: number;
  excludedIds: Set<string>;
  hideExcluded: boolean;
  onToggleHideExcluded: () => void;
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

function formatGap(gapM: number, t: TFunction): string {
  return gapM >= 1000
    ? t("poiList.gapKm", { km: (gapM / 1000).toFixed(1) })
    : t("poiList.gapM", { m: Math.round(gapM) });
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
  waypoints,
  onFocusWaypoint,
  radiusM,
  excludedIds,
  hideExcluded,
  onToggleHideExcluded,
  selectedId,
  onToggleExcluded,
  onFocusPoi,
  onHoverPoi,
}: Props) {
  const { t } = useTranslation();
  // excludedIds also remembers points that are not in the current results.
  const includedCount = pois.filter((poi) => !excludedIds.has(poi.id)).length;
  // Found points and file waypoints in route order (the sort is stable, so
  // the found points keep their own order).
  const rows: Row[] = [
    ...pois.map((poi): Row => ({ kind: "poi", poi, along: poi.distance_along_route_m })),
    ...waypoints.map((waypoint): Row => ({ kind: "waypoint", waypoint, along: waypoint.alongM })),
  ].sort((a, b) => a.along - b.along);

  // Hidden points drop out of the list, and the gaps between the remaining
  // stops are measured across them, counting what was left out.
  const view: { row: Row; gapM: number; hiddenBetween: number }[] = [];
  let previousAlong: number | null = null;
  let hiddenSince = 0;
  for (const row of rows) {
    if (row.kind === "poi" && hideExcluded && excludedIds.has(row.poi.id)) {
      hiddenSince++;
      continue;
    }
    view.push({ row, gapM: previousAlong === null ? 0 : row.along - previousAlong, hiddenBetween: hiddenSince });
    previousAlong = row.along;
    hiddenSince = 0;
  }
  const anyPoiShown = view.some(({ row }) => row.kind === "poi");
  const listRef = useRef<HTMLDivElement>(null);

  // Clicking a marker on the map selects it here too (see MapView's
  // onSelectPoi) - scrolling it into view is what makes that selection
  // actually visible instead of happening off-screen in a long list. In the
  // stacked layout the map is what stays in view, so the page isn't moved.
  useEffect(() => {
    if (!selectedId || isStackedLayout()) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-poi-id="${CSS.escape(selectedId)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedId]);

  return (
    <div className="side-panel">
      <div className="side-panel-head">
        <h2>{t("poiList.title")}</h2>
        {pois.length > 0 && (
          <div className="side-panel-head-right">
            <button
              className="poi-hide-toggle"
              onClick={onToggleHideExcluded}
              aria-pressed={hideExcluded}
              title={t(hideExcluded ? "poiList.showExcluded" : "poiList.hideExcluded")}
              aria-label={t(hideExcluded ? "poiList.showExcluded" : "poiList.hideExcluded")}
            >
              {hideExcluded ? <EyeOff size={15} strokeWidth={2} aria-hidden="true" /> : <Eye size={15} strokeWidth={2} aria-hidden="true" />}
            </button>
            <span className="count">
              {includedCount < pois.length
                ? t("poiList.count", { included: includedCount, total: pois.length })
                : pois.length}
            </span>
          </div>
        )}
      </div>
      <div className="poi-list" ref={listRef}>
        {pois.length === 0 && waypoints.length === 0 && <div className="empty-state">{t("poiList.empty")}</div>}
        {pois.length > 0 && !anyPoiShown && <div className="empty-state">{t("poiList.allHidden")}</div>}
        {view.map(({ row, gapM, hiddenBetween }) => {
          const showGap = gapM >= GAP_THRESHOLD_M;
          const gapHeight = showGap ? gapHeightPx(gapM) : 0;
          const gap = showGap && (
            <div className="poi-gap" style={{ height: `${gapHeight}px` }}>
              <div className="poi-gap-line" />
              <span className="poi-gap-label">
                {formatGap(gapM, t)}
                {hiddenBetween > 0 && ` (${t("poiList.hiddenBetween", { count: hiddenBetween })})`}
              </span>
            </div>
          );

          if (row.kind === "waypoint") {
            const { waypoint } = row;
            return (
              <Fragment key={waypoint.id}>
                {gap}
                <div className="poi-card waypoint-card" data-waypoint-id={waypoint.id} onClick={() => onFocusWaypoint(waypoint)}>
                  <span className="poi-card-check-spacer" aria-hidden="true" />
                  <div className="badge waypoint-badge" title={t("poiList.waypointFromFile")}>
                    <Flag size={17} strokeWidth={2} aria-hidden="true" />
                  </div>
                  <div className="poi-card-body">
                    <div className="name">{waypoint.name ?? t("poiList.waypointFromFile")}</div>
                    <div className="meta">
                      {t("poiList.metaKm", { km: (waypoint.alongM / 1000).toFixed(1) })}, {t("poiList.waypointFromFile")}
                    </div>
                  </div>
                </div>
              </Fragment>
            );
          }

          const poi = row.poi;
          const excluded = excludedIds.has(poi.id);
          const cat = categoryById(poi.category_id);
          const Icon = cat?.icon;
          // How far out this POI sits within the search radius itself, not
          // just its raw distance - a bar reads at a glance, a number needs
          // the radius held in your head to mean anything.
          const fillPct = Math.min(100, (poi.distance_to_route_m / radiusM) * 100);

          return (
            <Fragment key={poi.id}>
              {gap}
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
                <div className="badge" title={cat ? t(`categories.${cat.id}`) : poi.category_id}>
                  {Icon ? (
                    <Icon size={17} strokeWidth={2} aria-hidden="true" />
                  ) : (
                    cat && t(`categories.${cat.id}`).slice(0, 2)
                  )}
                </div>
                <div className="poi-card-body">
                  <div className="name">{poi.name ?? (cat ? t(`categories.${cat.id}`) : poi.category_id)}</div>
                  <div className="meta">
                    {t("poiList.metaKm", { km: (poi.distance_along_route_m / 1000).toFixed(1) })},{" "}
                    {t("poiList.metaDistance", { distance: Math.round(poi.distance_to_route_m) })}
                  </div>
                  <div
                    className="distance-bar"
                    title={t("poiList.distanceBarTitle", {
                      distance: Math.round(poi.distance_to_route_m),
                      radius: radiusM,
                    })}
                  >
                    <div className="distance-bar-fill" style={{ width: `${fillPct}%` }} />
                  </div>
                </div>
              </div>
            </Fragment>
          );
        })}
        {pois.length === 0 && waypoints.length > 0 && <div className="empty-state">{t("poiList.empty")}</div>}
      </div>
    </div>
  );
}
