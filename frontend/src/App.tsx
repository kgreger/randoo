import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AccountControl } from "./components/AccountControl";
import { AccountDialog } from "./components/AccountDialog";
import { CategoryFilter } from "./components/CategoryFilter";
import { MapView } from "./components/MapView";
import { PoiList } from "./components/PoiList";
import { SignInDialog } from "./components/SignInDialog";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "./i18n";
import { analyzeRoute, exportGpx, type Poi } from "./lib/api";
import { routeLengthM } from "./lib/geo";
import { parseGpxPreview, type LatLon } from "./lib/gpxPreview";
import { supabase } from "./lib/supabase";
import { useAuth } from "./lib/useAuth";

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
  const [excludedPoiIds, setExcludedPoiIds] = useState(new Set<string>());
  const [focusRequest, setFocusRequest] = useState<{ poi: Poi; nonce: number } | null>(null);
  const [hoveredPoiId, setHoveredPoiId] = useState<string | null>(null);
  const [selectedPoiId, setSelectedPoiId] = useState<string | null>(null);
  const [selectedCategories, setSelectedCategories] = useState(new Set(DEFAULT_CATEGORIES));
  const [radiusM, setRadiusM] = useState(500);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
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
    if (!user) setAccountOpen(false);
  }, [user]);

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
    setSelectedPoiId(null);
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
  }

  async function runSearch() {
    if (!file || selectedCategories.size === 0) return;
    const requestId = ++searchRequestId.current;
    setLoading(true);
    setError(null);
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
      // A previous search's exclusions and selection don't carry meaning
      // for a new set of results - stale ids just wouldn't match anything,
      // but starting fresh (and fully included) is the state a rider
      // actually expects.
      setExcludedPoiIds(new Set());
      setSelectedPoiId(null);
    } catch (err) {
      if (requestId !== searchRequestId.current) return;
      setError(err instanceof Error ? err.message : t("app.errorSearchFailed"));
    } finally {
      if (requestId === searchRequestId.current) setLoading(false);
    }
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
      const blob = await exportGpx(
        file,
        Array.from(selectedCategories),
        radiusM,
        accessToken,
        Array.from(excludedPoiIds),
      );
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
          <div className="mark">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 3 C8 8 6 11 6 14 a6 6 0 0 0 12 0 c0-3-4-6-6-11z" fill="#241a30" />
            </svg>
          </div>
          <h1>{t("app.title")}</h1>
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

        <div className="topbar-actions">
          <button className="btn btn-ghost" onClick={() => fileInputRef.current?.click()}>
            {file ? t("app.changeRoute") : t("app.uploadGpx")}
          </button>
          <button
            className={`btn btn-primary ${!user ? "btn-locked" : ""}`}
            onClick={handleExport}
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
          <AccountControl onRequestSignIn={() => setSignInOpen(true)} onOpenAccount={() => setAccountOpen(true)} />
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="content-row">
        <div className="map-panel">
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

          {accountOpen && <AccountDialog onClose={() => setAccountOpen(false)} />}

          {!file && !signInOpen && !accountOpen && (
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
            <div className="controls-panel">
              <CategoryFilter
                selected={selectedCategories}
                onToggle={toggleCategory}
                radiusM={radiusM}
                onRadiusChange={setRadiusM}
              />
              <button
                className="btn btn-primary"
                onClick={runSearch}
                disabled={selectedCategories.size === 0 || loading}
              >
                {loading ? t("app.searching") : t("app.findPoints")}
              </button>
            </div>
          )}

          <MapView
            route={route}
            pois={pois}
            excludedIds={excludedPoiIds}
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
          selectedId={selectedPoiId}
          onToggleExcluded={toggleExcluded}
          onFocusPoi={focusPoi}
          onHoverPoi={setHoveredPoiId}
        />
      </div>
    </div>
  );
}
