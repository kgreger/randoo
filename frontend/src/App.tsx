import { useEffect, useRef, useState } from "react";
import { AccountControl } from "./components/AccountControl";
import { CategoryFilter } from "./components/CategoryFilter";
import { MapView } from "./components/MapView";
import { PoiList } from "./components/PoiList";
import { SignInDialog } from "./components/SignInDialog";
import { analyzeRoute, exportGpx, type Poi } from "./lib/api";
import { routeLengthM } from "./lib/geo";
import { parseGpxPreview, type LatLon } from "./lib/gpxPreview";
import { supabase } from "./lib/supabase";
import { useAuth } from "./lib/useAuth";

const DEFAULT_CATEGORIES = ["water", "food"];

export default function App() {
  const { user, recoveryMode, clearRecoveryMode } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [routeName, setRouteName] = useState<string | null>(null);
  const [route, setRoute] = useState<LatLon[][]>([]);
  const [pois, setPois] = useState<Poi[]>([]);
  const [excludedPoiIds, setExcludedPoiIds] = useState(new Set<string>());
  const [focusRequest, setFocusRequest] = useState<{ poi: Poi; nonce: number } | null>(null);
  const [selectedCategories, setSelectedCategories] = useState(new Set(DEFAULT_CATEGORIES));
  const [radiusM, setRadiusM] = useState(500);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
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

  async function handleFile(selected: File) {
    setFile(selected);
    setRouteName(selected.name.replace(/\.gpx$/i, ""));
    setPois([]);
    setExcludedPoiIds(new Set());
    setError(null);
    try {
      const preview = await parseGpxPreview(selected);
      setRoute(preview);
    } catch {
      setError("Could not read that GPX file.");
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
      // A previous search's exclusions don't carry meaning for a new set of
      // results - stale ids just wouldn't match anything, but starting
      // fresh (and fully included) is the state a rider actually expects.
      setExcludedPoiIds(new Set());
    } catch (err) {
      if (requestId !== searchRequestId.current) return;
      setError(err instanceof Error ? err.message : "Search failed.");
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
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(false);
    }
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
          <h1>Randoo</h1>
        </div>

        {routeName && (
          <div className="route-meta">
            <span className="name">{routeName}</span>
            {distanceKm !== null && <span className="stat">{distanceKm.toFixed(1)} km</span>}
            {pois.length > 0 && <span className="stat">{pois.length} points found</span>}
          </div>
        )}

        <div className="topbar-actions">
          <button className="btn btn-ghost" onClick={() => fileInputRef.current?.click()}>
            {file ? "Change route" : "Upload GPX"}
          </button>
          <button
            className={`btn btn-primary ${!user ? "btn-locked" : ""}`}
            onClick={handleExport}
            disabled={pois.length === 0 || exporting}
            title={user ? undefined : "Sign in to export"}
          >
            {exporting ? "Exporting…" : "Export"}
            {!user && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
            )}
          </button>
          <AccountControl onRequestSignIn={() => setSignInOpen(true)} />
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

          {!file && !signInOpen && (
            <div className="map-empty">
              <div className="map-empty-card">
                <div className="icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ff8f6b" strokeWidth="1.8">
                    <path d="M12 15V3M7 8l5-5 5 5" />
                    <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
                  </svg>
                </div>
                <p>Upload a GPX track to see water, food, fuel, and other stops along it.</p>
                <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
                  Choose a GPX file
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
                {loading ? "Searching…" : "Find points"}
              </button>
            </div>
          )}

          <MapView route={route} pois={pois} excludedIds={excludedPoiIds} focusRequest={focusRequest} />
        </div>

        <PoiList
          pois={pois}
          radiusM={radiusM}
          excludedIds={excludedPoiIds}
          onToggleExcluded={toggleExcluded}
          onFocusPoi={focusPoi}
        />
      </div>
    </div>
  );
}
