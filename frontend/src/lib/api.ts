const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export interface Poi {
  id: string;
  osm_id: number;
  osm_type: string;
  lat: number;
  lon: number;
  category_id: string;
  name: string | null;
  distance_to_route_m: number;
  // Where to leave the route for this POI, and the path there (this POI
  // last). A straight line unless is_routed says BRouter found a real one.
  meeting_point: [number, number];
  connector_path: [number, number][];
  is_routed: boolean;
}

interface AnalyzeResponse {
  pois: Poi[];
  attribution: string;
}

function buildFormData(file: File, categoryIds: string[], radiusM: number): FormData {
  const form = new FormData();
  form.append("file", file);
  categoryIds.forEach((id) => form.append("categories", id));
  form.append("radius_m", String(radiusM));
  return form;
}

export async function analyzeRoute(
  file: File,
  categoryIds: string[],
  radiusM: number,
): Promise<Poi[]> {
  const response = await fetch(`${API_URL}/api/analyze`, {
    method: "POST",
    body: buildFormData(file, categoryIds, radiusM),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`analyze failed: ${detail}`);
  }

  const data: AnalyzeResponse = await response.json();
  return data.pois;
}

export async function exportGpx(
  file: File,
  categoryIds: string[],
  radiusM: number,
  accessToken: string,
): Promise<Blob> {
  const response = await fetch(`${API_URL}/api/export`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: buildFormData(file, categoryIds, radiusM),
  });

  if (response.status === 401) {
    throw new Error("Your session expired, sign in again to export.");
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`export failed: ${detail}`);
  }

  return response.blob();
}
