import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Eye, EyeOff, Pencil } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { Poi } from "../lib/api";
import type { RouteWaypoint } from "../lib/gpxPreview";
import { ASSIGNABLE_TYPES, WAYPOINT_TYPE, pointTypeById } from "../lib/categories";
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
  // Types given by hand, by point or waypoint id, and the way to change them
  // (null restores the original type).
  typeOverrides: Record<string, string>;
  onChangeType: (id: string, typeId: string | null) => void;
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
  typeOverrides,
  onChangeType,
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
  const totalCount = pois.length + waypoints.length;
  const includedCount =
    pois.filter((poi) => !excludedIds.has(poi.id)).length +
    waypoints.filter((waypoint) => !excludedIds.has(waypoint.id)).length;
  const [typeMenu, setTypeMenu] = useState<TypeMenuTarget | null>(null);
  const closeTypeMenu = useCallback(() => setTypeMenu(null), []);
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
    const id = row.kind === "poi" ? row.poi.id : row.waypoint.id;
    if (hideExcluded && excludedIds.has(id)) {
      hiddenSince++;
      continue;
    }
    view.push({ row, gapM: previousAlong === null ? 0 : row.along - previousAlong, hiddenBetween: hiddenSince });
    previousAlong = row.along;
    hiddenSince = 0;
  }
  const nothingShown = rows.length > 0 && view.length === 0;
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
        {totalCount > 0 && (
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
              {includedCount < totalCount
                ? t("poiList.count", { included: includedCount, total: totalCount })
                : totalCount}
            </span>
          </div>
        )}
      </div>
      <div className="poi-list" ref={listRef}>
        {pois.length === 0 && waypoints.length === 0 && <div className="empty-state">{t("poiList.empty")}</div>}
        {nothingShown && <div className="empty-state">{t("poiList.allHidden")}</div>}
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
            const waypointExcluded = excludedIds.has(waypoint.id);
            const typeId = typeOverrides[waypoint.id] ?? WAYPOINT_TYPE.id;
            const typeLabel = t(`categories.${typeId}`);
            return (
              <Fragment key={waypoint.id}>
                {gap}
                <div
                  className={`poi-card waypoint-card ${waypointExcluded ? "excluded" : ""}`}
                  data-waypoint-id={waypoint.id}
                  onClick={() => onFocusWaypoint(waypoint)}
                >
                  <label className="poi-card-check-wrap" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="poi-card-check"
                      checked={!waypointExcluded}
                      onChange={() => onToggleExcluded(waypoint.id)}
                    />
                  </label>
                  <TypeBadge
                    typeId={typeId}
                    overridden={waypoint.id in typeOverrides}
                    label={typeLabel}
                    onOpen={(rect) =>
                      setTypeMenu({
                        rect,
                        id: waypoint.id,
                        name: waypoint.name ?? typeLabel,
                        originalTypeId: WAYPOINT_TYPE.id,
                        overrideId: typeOverrides[waypoint.id] ?? null,
                      })
                    }
                  />
                  <div className="poi-card-body">
                    <div className="name">{waypoint.name ?? typeLabel}</div>
                    <div className="meta">
                      {t("poiList.metaKm", { km: (waypoint.alongM / 1000).toFixed(1) })},{" "}
                      {waypoint.id in typeOverrides ? typeLabel : t("poiList.waypointFromFile")}
                    </div>
                  </div>
                </div>
              </Fragment>
            );
          }

          const poi = row.poi;
          const excluded = excludedIds.has(poi.id);
          const typeId = typeOverrides[poi.id] ?? poi.category_id;
          const typeLabel = pointTypeById(typeId) ? t(`categories.${typeId}`) : poi.category_id;
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
                <TypeBadge
                  typeId={typeId}
                  overridden={poi.id in typeOverrides}
                  label={typeLabel}
                  onOpen={(rect) =>
                    setTypeMenu({
                      rect,
                      id: poi.id,
                      name: poi.name ?? typeLabel,
                      originalTypeId: poi.category_id,
                      overrideId: typeOverrides[poi.id] ?? null,
                    })
                  }
                />
                <div className="poi-card-body">
                  <div className="name">{poi.name ?? typeLabel}</div>
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
      {typeMenu && (
        <TypeMenu
          target={typeMenu}
          onChoose={(typeId) => {
            onChangeType(typeMenu.id, typeId);
            setTypeMenu(null);
          }}
          onClose={closeTypeMenu}
        />
      )}
    </div>
  );
}

interface TypeMenuTarget {
  rect: DOMRect;
  id: string;
  name: string;
  originalTypeId: string;
  overrideId: string | null;
}

// The point's symbol, which doubles as the way to change its type: a pencil
// shows on hover (and always on touch screens, see styles.css).
function TypeBadge({
  typeId,
  overridden,
  label,
  onOpen,
}: {
  typeId: string;
  overridden: boolean;
  label: string;
  onOpen: (rect: DOMRect) => void;
}) {
  const { t } = useTranslation();
  const Icon = pointTypeById(typeId)?.icon;
  return (
    <button
      type="button"
      className={`badge badge-editable ${overridden ? "badge-overridden" : ""}`}
      title={`${label} · ${t("poiList.changeType")}`}
      aria-label={`${label}, ${t("poiList.changeType")}`}
      aria-haspopup="menu"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(e.currentTarget.getBoundingClientRect());
      }}
    >
      {Icon ? <Icon size={17} strokeWidth={2} aria-hidden="true" /> : label.slice(0, 2)}
      <span className="badge-pencil" aria-hidden="true">
        <Pencil size={9} strokeWidth={2.4} />
      </span>
    </button>
  );
}

// A small menu next to the symbol: the types a rider can assign, and the
// original type to go back to. Drawn in the page body so the list's own
// scrolling cannot clip it.
function TypeMenu({
  target,
  onChoose,
  onClose,
}: {
  target: TypeMenuTarget;
  onChoose: (typeId: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    // Scroll events do not bubble, so listen in the capture phase to also catch
    // the list and the page scrolling away from under the menu.
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  const width = 230;
  const left = Math.max(8, Math.min(target.rect.left, window.innerWidth - width - 8));
  const below = target.rect.bottom + 6;
  const top = below + 150 > window.innerHeight ? Math.max(8, target.rect.top - 150) : below;
  const originalLabel = t(`categories.${target.originalTypeId}`);

  return createPortal(
    <div className="type-menu" ref={menuRef} role="menu" style={{ left, top, width }}>
      <div className="type-menu-title">{target.name}</div>
      {ASSIGNABLE_TYPES.map((type) => {
        const Icon = type.icon;
        return (
          <button key={type.id} className="type-menu-item" role="menuitem" onClick={() => onChoose(type.id)}>
            <Icon size={15} strokeWidth={2} aria-hidden="true" />
            <span>{t(`categories.${type.id}`)}</span>
            {target.overrideId === type.id && <Check size={14} strokeWidth={2.4} aria-hidden="true" />}
          </button>
        );
      })}
      <button className="type-menu-item" role="menuitem" onClick={() => onChoose(null)}>
        {(() => {
          const Icon = pointTypeById(target.originalTypeId)?.icon;
          return Icon ? <Icon size={15} strokeWidth={2} aria-hidden="true" /> : null;
        })()}
        <span>{t("poiList.originalType", { type: originalLabel })}</span>
        {target.overrideId === null && <Check size={14} strokeWidth={2.4} aria-hidden="true" />}
      </button>
    </div>,
    document.body,
  );
}
