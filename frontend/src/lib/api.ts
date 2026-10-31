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
  // How far along the route (cumulative across all recorded segments) this
  // POI's nearest point falls - the route-km it shows up at for the rider.
  distance_along_route_m: number;
  // Where to leave the route for this POI, and the path there (this POI
  // last). A straight line unless is_routed says BRouter found a real one.
  meeting_point: [number, number];
  connector_path: [number, number][];
  is_routed: boolean;
}

// A failed request, with the HTTP status so the caller can word it for the
// rider (a body too large for the server, for one, comes back as nginx's own
// HTML page, which is no message to show).
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// The export would give the rider's device more course points than it takes
// reliably; nothing was exported.
export class PointLimitError extends Error {
  constructor(
    readonly coursePoints: number,
    readonly limit: number,
    // How many files it takes to stay within the limit.
    readonly parts: number,
  ) {
    super(`export would have ${coursePoints} course points, the device takes ${limit}`);
  }
}

async function failure(response: Response, what: string): Promise<ApiError> {
  const detail = (await response.text()).trim();
  const readable = detail.startsWith("<") ? `${response.status} ${response.statusText}`.trim() : detail;
  return new ApiError(`${what} failed: ${readable}`, response.status);
}

interface AnalyzeResponse {
  pois: Poi[];
  search_id: string;
  routing: boolean;
  attribution: string;
}

// The points come back with straight connectors. When routing is true, the
// routed ones are asked for afterwards with routeConnectors, under searchId.
export interface SearchResult {
  pois: Poi[];
  searchId: string;
  routing: boolean;
}

export type RoutedConnector = Pick<Poi, "id" | "meeting_point" | "connector_path" | "is_routed">;

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
  accessToken?: string,
): Promise<SearchResult> {
  // Search stays fully anonymous-friendly - the token is only sent along
  // when there is one, purely so a signed-in premium caller gets identified.
  // No token at all is a normal, expected case here, unlike export.
  const response = await fetch(`${API_URL}/api/analyze`, {
    method: "POST",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    body: buildFormData(file, categoryIds, radiusM),
  });

  if (!response.ok) throw await failure(response, "analyze");

  const data: AnalyzeResponse = await response.json();
  return { pois: data.pois, searchId: data.search_id, routing: data.routing };
}

export async function routeConnectors(
  searchId: string,
  poiIds: string[],
  accessToken?: string,
): Promise<RoutedConnector[]> {
  const response = await fetch(`${API_URL}/api/route-connectors`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ search_id: searchId, poi_ids: poiIds }),
  });

  if (!response.ok) throw await failure(response, "routing");

  const data: { pois: RoutedConnector[] } = await response.json();
  return data.pois;
}

// One file of a route that was split to stay within the device's limit.
export interface ExportPart {
  name: string;
  filename: string;
  gpx: string;
}

interface ExportOptions {
  ignorePointLimit?: boolean;
  split?: { courseName: string };
}

// Sends the points the rider is looking at along with the route, so the file
// holds exactly those (a saved plan included) and the server doesn't search
// again.
async function postExport(
  file: File,
  pois: Poi[],
  accessToken: string,
  excludedPoiIds: string[],
  typeOverrides: Record<string, string>,
  device: { make: string; model: string } | null,
  options: ExportOptions,
): Promise<Response> {
  const form = new FormData();
  form.append("file", file);
  form.append(
    "pois",
    JSON.stringify(
      pois.map(({ id, osm_id, osm_type, lat, lon, category_id, name, distance_to_route_m, meeting_point }) => ({
        id,
        osm_id,
        osm_type,
        lat,
        lon,
        // A type the rider gave the point by hand replaces its category.
        category_id: typeOverrides[id] ?? category_id,
        name,
        distance_to_route_m,
        meeting_point,
      })),
    ),
  );
  excludedPoiIds.forEach((id) => form.append("excluded_poi_ids", id));
  form.append("type_overrides", JSON.stringify(typeOverrides));
  // The rider's device, so the backend can shape the file for it.
  if (device?.make) {
    form.append("device_make", device.make);
    if (device.model) form.append("device_model", device.model);
  }
  if (options.ignorePointLimit) form.append("ignore_point_limit", "true");
  if (options.split) {
    form.append("split", "true");
    form.append("course_name", options.split.courseName);
  }

  const response = await fetch(`${API_URL}/api/export`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });

  if (response.status === 401) {
    throw new Error("Your session expired, sign in again to export.");
  }
  if (response.status === 409) {
    const body = await response.json().catch(() => null);
    if (body?.code === "too_many_course_points") {
      throw new PointLimitError(body.course_points, body.limit, body.parts);
    }
  }
  if (!response.ok) throw await failure(response, "export");

  return response;
}

export async function exportGpx(
  file: File,
  pois: Poi[],
  accessToken: string,
  excludedPoiIds: string[] = [],
  typeOverrides: Record<string, string> = {},
  device: { make: string; model: string } | null = null,
  ignorePointLimit = false,
): Promise<Blob> {
  const response = await postExport(file, pois, accessToken, excludedPoiIds, typeOverrides, device, {
    ignorePointLimit,
  });
  return response.blob();
}

// The route cut into files that each stay within the device's limit, named
// after the course.
export async function exportGpxParts(
  file: File,
  pois: Poi[],
  accessToken: string,
  courseName: string,
  excludedPoiIds: string[] = [],
  typeOverrides: Record<string, string> = {},
  device: { make: string; model: string } | null = null,
): Promise<ExportPart[]> {
  const response = await postExport(file, pois, accessToken, excludedPoiIds, typeOverrides, device, {
    split: { courseName },
  });
  const body: { parts: ExportPart[] } = await response.json();
  return body.parts;
}
