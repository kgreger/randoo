import { useState } from "react";
import { CategoryFilter } from "./components/CategoryFilter";
import { MapView } from "./components/MapView";
import { PoiList } from "./components/PoiList";
import { UploadPanel } from "./components/UploadPanel";
import { analyzeRoute, exportGpx, type Poi } from "./lib/api";
import { parseGpxPreview, type LatLon } from "./lib/gpxPreview";

const DEFAULT_CATEGORIES = ["water", "food"];

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [route, setRoute] = useState<LatLon[]>([]);
  const [pois, setPois] = useState<Poi[]>([]);
  const [selectedCategories, setSelectedCategories] = useState(new Set(DEFAULT_CATEGORIES));
  const [radiusM, setRadiusM] = useState(500);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(selected: File) {
    setFile(selected);
    setError(null);
    try {
      const preview = await parseGpxPreview(selected);
      setRoute(preview);
    } catch {
      setError("Could not read that GPX file.");
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
    setExporting(true);
    try {
      const blob = await exportGpx(file, Array.from(selectedCategories), radiusM);
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

  return (
    <div className="app">
      <div className="main-column">
        <div className="topbar">
          <h1>Randoo</h1>
          <UploadPanel onFileSelected={handleFile} fileName={file?.name ?? null} />
        </div>

        {error && <div style={{ color: "#e28a79" }}>{error}</div>}

        <div className="content-row">
          <div className="map-panel">
            <div className="controls-panel">
              <CategoryFilter
                selected={selectedCategories}
                onToggle={toggleCategory}
                radiusM={radiusM}
                onRadiusChange={setRadiusM}
              />
              <button
                className="export-button"
                onClick={runSearch}
                disabled={!file || selectedCategories.size === 0 || loading}
                style={{ margin: 0 }}
              >
                {loading ? "Searching…" : "Find points"}
              </button>
            </div>
            <MapView route={route} pois={pois} />
          </div>
          <PoiList pois={pois} onExport={handleExport} exporting={exporting} />
        </div>
      </div>
    </div>
  );
}
