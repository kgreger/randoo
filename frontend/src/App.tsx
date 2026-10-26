import { useEffect, useRef, useState } from "react";
import { Bookmark, Menu, SlidersHorizontal, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AccountControl } from "./components/AccountControl";
import { AccountDialog } from "./components/AccountDialog";
import { DeleteAccountDialog } from "./components/DeleteAccountDialog";
import { CategoryFilter } from "./components/CategoryFilter";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { LegalLinks } from "./components/LegalLinks";
import { MapView } from "./components/MapView";
import { PlansDialog } from "./components/PlansDialog";
import { PoiList } from "./components/PoiList";
import { SavePlanDialog } from "./components/SavePlanDialog";
import { SignInDialog } from "./components/SignInDialog";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "./i18n";
import { analyzeRoute, exportGpx, type Poi } from "./lib/api";
import { routeLengthM } from "./lib/geo";
import { isStackedLayout } from "./lib/layout";
import { parseGpxPreview, type LatLon } from "./lib/gpxPreview";
import { createPlan, updatePlan, type LoadedPlan, type PlanSummary } from "./lib/plans";
import { supabase } from "./lib/supabase";
import { useAuth } from "./lib/useAuth";
import { useCanSavePlans } from "./lib/useTier";
import logoUrl from "./assets/randoo-logo.svg";

// Comparable form of what a plan stores, for telling saved results from
// changed ones.
function resultsSignature(state: {
  poiIds: string[];
  excludedIds: string[];
  hideExcluded: boolean;
  categoryIds: string[];
  radiusM: number;
}): string {
  return JSON.stringify([
    state.poiIds,
    [...state.excludedIds].sort(),
    state.hideExcluded,
    [...state.categoryIds].sort(),
    state.radiusM,
  ]);
}

const DEFAULT_CATEGORIES = ["water", "food"];
const IDEAS_URL = import.meta.env.VITE_IDEAS_URL as string | undefined;

export default function App() {
  const { t, i18n } = useTranslation();
  const { user, recoveryMode, clearRecoveryMode } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [routeName, setRouteName] = useState<string | null>(null);
  const [route, setRoute] = useState<LatLon[][]>([]);
  const [pois, setPois] = useState<Poi[]>([]);
  // Every point the rider unticked for this route, not only those in the
  // current results: a search that finds one again restores its state, and a
  // saved plan keeps them all. Cleared when another route is loaded.
  const [excludedPoiIds, setExcludedPoiIds] = useState(new Set<string>());
  const [focusRequest, setFocusRequest] = useState<{ poi: Poi; nonce: number } | null>(null);
  const [hoveredPoiId, setHoveredPoiId] = useState<string | null>(null);
  const [selectedPoiId, setSelectedPoiId] = useState<string | null>(null);
  const [selectedCategories, setSelectedCategories] = useState(new Set(DEFAULT_CATEGORIES));
  const [radiusM, setRadiusM] = useState(500);
  const [loading, setLoading] = useState(false);
  const [searchElapsedS, setSearchElapsedS] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hideExcluded, setHideExcluded] = useState(false);
  // Set while the rider is asked to confirm a search that drops points
  // already found, with how many of each category would go.
  const [searchWarning, setSearchWarning] = useState<{ categoryId: string; count: number }[] | null>(null);
  // A plan the rider picked while the current results are not saved, waiting
  // for the confirmation to replace them.
  const [pendingPlan, setPendingPlan] = useState<LoadedPlan | null>(null);
  // Same for choosing another route file.
  const [routeChangePending, setRouteChangePending] = useState(false);
  // What the shown results looked like when they were last saved or opened
  // as a plan (see resultsSignature), to tell unsaved results from saved ones.
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [plansOpen, setPlansOpen] = useState(false);
  // Which saved route and plan the current results belong to, so a further
  // save can add a plan to the same route or overwrite the open plan.
  const [savedRouteId, setSavedRouteId] = useState<string | null>(null);
  const [openPlan, setOpenPlan] = useState<{ id: string; name: string } | null>(null);
  // Categories and radius the shown results were searched with; the filter
  // controls may have been changed since without searching again.
  const [searched, setSearched] = useState<{ categoryIds: string[]; radiusM: number } | null>(null);
  const canSavePlans = useCanSavePlans();
  const [filtersOpen, setFiltersOpen] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);
  const mapPanelRef = useRef<HTMLDivElement>(null);
  // A slow search (real Overpass round-trips can take tens of seconds) that
  // a rider re-runs before it finishes - a new category, say - must never
  // have its late answer overwrite the newer search's already-shown
  // results. Bumped at the start of every search; a response only gets
  // applied if it's still the most recent one requested.
  const searchRequestId = useRef(0);

  useEffect(() => {
    if (user && !recoveryMode) setSignInOpen(false);
  }, [user, recoveryMode]);

  useEffect(() => {
    if (recoveryMode) setSignInOpen(true);
  }, [recoveryMode]);

  useEffect(() => {
    if (!menuOpen) return;
    function handlePointerDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [menuOpen]);

  useEffect(() => {
    if (!user) {
      setAccountOpen(false);
      setDeleteOpen(false);
      setSaveOpen(false);
      setPlansOpen(false);
      setSavedRouteId(null);
      setOpenPlan(null);
    }
  }, [user]);

  // A search can genuinely take anywhere from a couple seconds to over a
  // minute (a dense route routes every POI's connector through BRouter) -
  // with no way to report real progress from a single request/response,
  // showing elapsed time at least confirms it's still working, not stuck.
  useEffect(() => {
    if (!loading) return;
    setSearchElapsedS(0);
    const interval = window.setInterval(() => setSearchElapsedS((s) => s + 1), 1000);
    return () => window.clearInterval(interval);
  }, [loading]);

  // An account-level preference (set via AccountDialog's language switcher)
  // wins over whatever this browser had detected/stored on its own once at
  // sign-in - it's the whole point of persisting it on the account rather
  // than just locally. Applied once per login (tracked by user id), not on
  // every `user` update: a later manual switch updates `user_metadata`
  // asynchronously (and may not land at all, say the update call fails),
  // so re-applying it on every render would otherwise fight a rider's own
  // more recent choice and snap it back.
  const languageSyncedForUserId = useRef<string | null>(null);
  useEffect(() => {
    if (!user || languageSyncedForUserId.current === user.id) return;
    languageSyncedForUserId.current = user.id;
    const accountLanguage = user.user_metadata?.language as string | undefined;
    if (accountLanguage && (SUPPORTED_LANGUAGES as readonly string[]).includes(accountLanguage)) {
      if (accountLanguage !== i18n.language) i18n.changeLanguage(accountLanguage as SupportedLanguage);
    }
  }, [user, i18n]);

  async function handleFile(selected: File) {
    setFile(selected);
    setRouteName(selected.name.replace(/\.gpx$/i, ""));
    setPois([]);
    setExcludedPoiIds(new Set());
    setHideExcluded(false);
    setSelectedPoiId(null);
    setFiltersOpen(true);
    setSavedRouteId(null);
    setOpenPlan(null);
    setSavedSignature(null);
    setSearched(null);
    setError(null);
    try {
      const preview = await parseGpxPreview(selected);
      setRoute(preview);
    } catch {
      setError(t("app.errorGpxParse"));
      setRoute([]);
    }
  }

  function toggleCategory(id: string) {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // A search replaces the shown results, so points of a category that is no
  // longer selected would silently disappear: ask first.
  function requestSearch() {
    const dropped = new Map<string, number>();
    for (const poi of pois) {
      if (!selectedCategories.has(poi.category_id)) {
        dropped.set(poi.category_id, (dropped.get(poi.category_id) ?? 0) + 1);
      }
    }
    if (dropped.size === 0) {
      runSearch();
      return;
    }
    setSearchWarning(Array.from(dropped, ([categoryId, count]) => ({ categoryId, count })));
  }

  function toggleExcluded(id: string) {
    setExcludedPoiIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function focusPoi(poi: Poi) {
    // The nonce means clicking the same card twice in a row (say, after
    // panning away from it) re-centers the map both times - relying on the
    // poi object alone wouldn't re-trigger the effect the second time,
    // since it's the same reference as last render.
    setFocusRequest((prev) => ({ poi, nonce: (prev?.nonce ?? 0) + 1 }));
    setSelectedPoiId(poi.id);
    // With the list below the map, the picked point would otherwise be
    // centered somewhere off-screen.
    if (isStackedLayout()) mapPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function runSearch() {
    if (!file || selectedCategories.size === 0) return;
    const requestId = ++searchRequestId.current;
    setLoading(true);
    setError(null);
    setHideExcluded(false);
    setFiltersOpen(false);
    try {
      // Sent along when there's a session, but search runs fine without one
      // too - this only ever upgrades a signed-in premium caller's results,
      // never gates the search itself the way export's sign-in does.
      const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } };
      const accessToken = data.session?.access_token;

      const results = await analyzeRoute(file, Array.from(selectedCategories), radiusM, accessToken);
      // A newer search already started (and maybe already finished) while
      // this one was still in flight - its results are stale, showing them
      // now would silently undo whatever the rider is already looking at.
      if (requestId !== searchRequestId.current) return;
      setPois(results);
      // The unticked points stay remembered (see excludedPoiIds), so a point
      // found again comes back unticked; only the highlighted one is reset.
      setSelectedPoiId(null);
      setSearched({ categoryIds: Array.from(selectedCategories), radiusM });
    } catch (err) {
      if (requestId !== searchRequestId.current) return;
      setError(err instanceof Error ? err.message : t("app.errorSearchFailed"));
    } finally {
      if (requestId === searchRequestId.current) setLoading(false);
    }
  }

  function currentSignature() {
    return resultsSignature({
      poiIds: pois.map((poi) => poi.id),
      excludedIds: Array.from(excludedPoiIds),
      hideExcluded,
      categoryIds: searched?.categoryIds ?? [],
      radiusM: searched?.radiusM ?? radiusM,
    });
  }

  function handleSaveClick() {
    if (!user) {
      setSignInOpen(true);
    } else if (!canSavePlans) {
      setError(t("plans.premiumOnly"));
    } else {
      setSaveOpen(true);
    }
  }

  async function savePlan(name: string, asNew: boolean) {
    if (!file || !searched) return;
    const input = {
      name,
      categoryIds: searched.categoryIds,
      radiusM: searched.radiusM,
      pois,
      excludedPoiIds: Array.from(excludedPoiIds),
      hideExcluded,
    };
    if (openPlan && !asNew) {
      await updatePlan(openPlan.id, input);
      setOpenPlan({ id: openPlan.id, name });
    } else {
      const saved = await createPlan(input, {
        id: savedRouteId,
        name: routeName ?? file.name,
        gpx: await file.text(),
        distanceM: distanceKm !== null ? distanceKm * 1000 : null,
      });
      setSavedRouteId(saved.routeId);
      setOpenPlan({ id: saved.planId, name });
    }
    setSavedSignature(currentSignature());
    setSaveOpen(false);
  }

  // Results that are shown but neither saved nor opened from a plan would be
  // lost by loading another plan or another route, so those ask first.
  function hasUnsavedResults() {
    return pois.length > 0 && currentSignature() !== savedSignature;
  }

  function requestRouteChange() {
    if (hasUnsavedResults()) setRouteChangePending(true);
    else fileInputRef.current?.click();
  }

  function requestOpenPlan(plan: LoadedPlan) {
    if (hasUnsavedResults()) {
      setPlansOpen(false);
      setPendingPlan(plan);
    } else {
      handleOpenPlan(plan);
    }
  }

  async function handleOpenPlan(plan: LoadedPlan) {
    const gpx = new File([plan.route.gpx], `${plan.route.name}.gpx`, { type: "application/gpx+xml" });
    handleFile(gpx);
    setRouteName(plan.route.name);
    setPois(plan.pois);
    setExcludedPoiIds(new Set(plan.excluded_poi_ids));
    setHideExcluded(plan.hide_excluded);
    setSelectedCategories(new Set(plan.category_ids));
    setRadiusM(plan.radius_m);
    setSearched({ categoryIds: plan.category_ids, radiusM: plan.radius_m });
    setSavedRouteId(plan.route.id);
    setOpenPlan({ id: plan.id, name: plan.name });
    setSavedSignature(
      resultsSignature({
        poiIds: plan.pois.map((poi) => poi.id),
        excludedIds: plan.excluded_poi_ids,
        hideExcluded: plan.hide_excluded,
        categoryIds: plan.category_ids,
        radiusM: plan.radius_m,
      }),
    );
    setFiltersOpen(false);
    setPlansOpen(false);
  }

  function handlePlanDeleted(plan: PlanSummary, routeRemoved: boolean) {
    if (openPlan?.id === plan.id) setOpenPlan(null);
    if (routeRemoved && savedRouteId === plan.route.id) setSavedRouteId(null);
  }

  async function handleExport() {
    if (!file) return;

    const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } };
    const accessToken = data.session?.access_token;
    if (!accessToken) {
      setSignInOpen(true);
      return;
    }

    setExporting(true);
    try {
      const blob = await exportGpx(file, pois, accessToken, Array.from(excludedPoiIds));
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "randoo-pois.gpx";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("app.errorExportFailed"));
    } finally {
      setExporting(false);
    }
  }

  async function handleIdeas() {
    if (!IDEAS_URL) return;

    const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } };
    const session = data.session;
    if (!session) {
      setSignInOpen(true);
      return;
    }

    // Tokens travel in the fragment, not the query string, so they never
    // reach a server log or a Referer header - the idea portal reads them
    // client-side and immediately scrubs the URL.
    const url = new URL(IDEAS_URL);
    url.searchParams.set("project", "randoo");
    url.hash = `access_token=${session.access_token}&refresh_token=${session.refresh_token}`;
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  }

  const hasRoute = route.some((segment) => segment.length > 1);
  const distanceKm = hasRoute ? routeLengthM(route) / 1000 : null;

  return (
    <div className="app">
      <input
        ref={fileInputRef}
        className="file-input"
        type="file"
        accept=".gpx"
        onChange={(e) => {
          const selected = e.target.files?.[0];
          if (selected) handleFile(selected);
        }}
      />

      <div className="topbar">
        <div className="brand">
          <h1>
            <img className="brand-logo" src={logoUrl} alt={t("app.title")} />
          </h1>
          <span className="beta-badge">Beta</span>
          {IDEAS_URL && (
            <button className="feedback-link" onClick={handleIdeas}>
              {t("app.ideas")}
            </button>
          )}
        </div>

        {routeName && (
          <div className="route-meta">
            <span className="name">{routeName}</span>
            {distanceKm !== null && (
              <span className="stat">{t("app.distanceKm", { km: distanceKm.toFixed(1) })}</span>
            )}
            {pois.length > 0 && <span className="stat">{t("app.pointsFound", { count: pois.length })}</span>}
          </div>
        )}

        <div className="topbar-menu" ref={menuRef}>
          <button
            className="menu-toggle"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={t("app.menu")}
            aria-expanded={menuOpen}
            aria-controls="topbar-actions"
          >
            {menuOpen ? <X size={20} strokeWidth={2} aria-hidden="true" /> : <Menu size={20} strokeWidth={2} aria-hidden="true" />}
          </button>
          <div id="topbar-actions" className={`topbar-actions ${menuOpen ? "open" : ""}`}>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setMenuOpen(false);
                requestRouteChange();
              }}
            >
              {file ? t("app.changeRoute") : t("app.uploadGpx")}
            </button>
            {pois.length > 0 && (
              <button
                className={`btn btn-ghost ${!canSavePlans ? "btn-locked" : ""}`}
                onClick={() => {
                  setMenuOpen(false);
                  handleSaveClick();
                }}
                title={canSavePlans ? undefined : t("plans.premiumOnly")}
              >
                <Bookmark size={14} strokeWidth={2} aria-hidden="true" />
                {t("plans.saveButton")}
              </button>
            )}
            <button
              className={`btn btn-primary ${!user ? "btn-locked" : ""}`}
              onClick={() => {
                setMenuOpen(false);
                handleExport();
              }}
              disabled={pois.length === 0 || exporting}
              title={user ? undefined : t("app.signInToExport")}
            >
              {exporting ? t("app.exporting") : t("app.export")}
              {!user && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="5" y="11" width="14" height="9" rx="2" />
                  <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                </svg>
              )}
            </button>
            <AccountControl
              onRequestSignIn={() => {
                setMenuOpen(false);
                setSignInOpen(true);
              }}
              onOpenAccount={() => {
                setMenuOpen(false);
                setAccountOpen(true);
              }}
              onOpenPlans={
                canSavePlans
                  ? () => {
                      setMenuOpen(false);
                      setPlansOpen(true);
                    }
                  : undefined
              }
            />
          </div>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="content-row">
        <div className="map-panel" ref={mapPanelRef}>
          {signInOpen && (
            <SignInDialog
              onClose={() => setSignInOpen(false)}
              recoveryMode={recoveryMode}
              onRecoveryDone={() => {
                clearRecoveryMode();
                setSignInOpen(false);
              }}
            />
          )}

          {accountOpen && (
            <AccountDialog
              onClose={() => setAccountOpen(false)}
              onRequestDelete={() => {
                setAccountOpen(false);
                setDeleteOpen(true);
              }}
            />
          )}
          {deleteOpen && <DeleteAccountDialog onClose={() => setDeleteOpen(false)} />}

          {saveOpen && (
            <SavePlanDialog
              defaultName={(searched?.categoryIds ?? [])
                .map((id) => t(`categories.${id}`))
                .concat(t("categories.radiusValue", { value: searched?.radiusM ?? radiusM }))
                .join(", ")}
              openPlanName={openPlan?.name ?? null}
              onSave={savePlan}
              onClose={() => setSaveOpen(false)}
            />
          )}

          {searchWarning && (
            <ConfirmDialog
              text={t("searchWarning.text", {
                categories: searchWarning
                  .map(({ categoryId, count }) => `${t(`categories.${categoryId}`)} (${count})`)
                  .join(", "),
              })}
              hint={t("searchWarning.hint")}
              confirmLabel={t("searchWarning.confirm")}
              cancelLabel={t("searchWarning.cancel")}
              onConfirm={() => {
                setSearchWarning(null);
                runSearch();
              }}
              onCancel={() => setSearchWarning(null)}
            />
          )}

          {routeChangePending && (
            <ConfirmDialog
              text={t("changeRouteWarning.text")}
              confirmLabel={t("changeRouteWarning.confirm")}
              cancelLabel={t("changeRouteWarning.cancel")}
              onConfirm={() => {
                setRouteChangePending(false);
                fileInputRef.current?.click();
              }}
              onCancel={() => setRouteChangePending(false)}
            />
          )}

          {pendingPlan && (
            <ConfirmDialog
              text={t("openPlanWarning.text")}
              confirmLabel={t("openPlanWarning.confirm")}
              cancelLabel={t("openPlanWarning.cancel")}
              onConfirm={() => {
                const plan = pendingPlan;
                setPendingPlan(null);
                handleOpenPlan(plan);
              }}
              onCancel={() => {
                setPendingPlan(null);
                setPlansOpen(true);
              }}
            />
          )}

          {plansOpen && (
            <PlansDialog onOpen={requestOpenPlan} onDeleted={handlePlanDeleted} onClose={() => setPlansOpen(false)} />
          )}

          {!file && !signInOpen && !accountOpen && !deleteOpen && !saveOpen && !plansOpen && !searchWarning && !pendingPlan && !routeChangePending && (
            <div className="map-empty">
              <div className="map-empty-card">
                <div className="icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ff8f6b" strokeWidth="1.8">
                    <path d="M12 15V3M7 8l5-5 5 5" />
                    <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
                  </svg>
                </div>
                <p>{t("app.uploadPrompt")}</p>
                <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
                  {t("app.chooseFile")}
                </button>
              </div>
            </div>
          )}

          {file && (
            <div className={`controls-panel ${filtersOpen ? "" : "collapsed"} ${loading ? "busy" : ""}`}>
              <button
                className="controls-toggle"
                onClick={() => setFiltersOpen((open) => !open)}
                aria-expanded={filtersOpen}
                aria-label={t("app.filters")}
              >
                <SlidersHorizontal size={16} strokeWidth={2} aria-hidden="true" />
                <span className="controls-toggle-label">{t("app.filters")}</span>
                <span className="controls-toggle-count">{selectedCategories.size}</span>
              </button>
              <div className="controls-body">
                <CategoryFilter
                  selected={selectedCategories}
                  onToggle={toggleCategory}
                  radiusM={radiusM}
                  onRadiusChange={setRadiusM}
                />
                <button
                  className="btn btn-primary"
                  onClick={requestSearch}
                  disabled={selectedCategories.size === 0 || loading}
                >
                  {loading ? t("app.searchingElapsed", { s: searchElapsedS }) : t("app.findPoints")}
                </button>
                {loading && (
                  <div className="search-progress" role="progressbar" aria-label={t("app.searching")}>
                    <div className="search-progress-bar" />
                  </div>
                )}
              </div>
            </div>
          )}

          <MapView
            route={route}
            pois={pois}
            excludedIds={excludedPoiIds}
            hideExcluded={hideExcluded}
            onToggleHideExcluded={() => setHideExcluded((hidden) => !hidden)}
            focusRequest={focusRequest}
            hoveredId={hoveredPoiId}
            selectedId={selectedPoiId}
            onSelectPoi={(poi) => setSelectedPoiId(poi.id)}
          />
        </div>

        <PoiList
          pois={pois}
          radiusM={radiusM}
          excludedIds={excludedPoiIds}
          hideExcluded={hideExcluded}
          onToggleHideExcluded={() => setHideExcluded((hidden) => !hidden)}
          selectedId={selectedPoiId}
          onToggleExcluded={toggleExcluded}
          onFocusPoi={focusPoi}
          onHoverPoi={setHoveredPoiId}
        />
      </div>

      <LegalLinks />
    </div>
  );
}
