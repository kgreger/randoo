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
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [routeName, setRouteName] = useState<string | null>(null);
  const [route, setRoute] = useState<LatLon[]>([]);
  const [pois, setPois] = useState<Poi[]>([]);
  const [selectedCategories, setSelectedCategories] = useState(new Set(DEFAULT_CATEGORIES));
  const [radiusM, setRadiusM] = useState(500);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);

  useEffect(() => {
    if (user) setSignInOpen(false);
  }, [user]);

  async function handleFile(selected: File) {
    setFile(selected);
    setRouteName(selected.name.replace(/\.gpx$/i, ""));
    setPois([]);
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

  async function runSearch() {
    if (!file || selectedCategories.size === 0) return;
    setLoading(true);
    setError(null);
    try {
      const results = await analyzeRoute(file, Array.from(selectedCategories), radiusM);
      setPois(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setLoading(false);
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
      const blob = await exportGpx(file, Array.from(selectedCategories), radiusM, accessToken);
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

  const distanceKm = route.length > 1 ? routeLengthM(route) / 1000 : null;

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
              <path d="M12 3 C8 8 6 11 6 14 a6 6 0 0 0 12 0 c0-3-4-6-6-11z" fill="#2a1740" />
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
          <button className="btn btn-primary" onClick={handleExport} disabled={pois.length === 0 || exporting}>
            {exporting ? "Exporting…" : user ? "Export GPX" : "Sign in to export"}
          </button>
          <AccountControl onRequestSignIn={() => setSignInOpen(true)} />
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="content-row">
        <div className="map-panel">
          {signInOpen && <SignInDialog onClose={() => setSignInOpen(false)} />}

          {!file && !signInOpen && (
            <div className="map-empty">
              <div className="map-empty-card">
                <div className="icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffb35c" strokeWidth="1.8">
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

          <MapView route={route} pois={pois} />
        </div>

        <PoiList pois={pois} />
      </div>
    </div>
  );
}
