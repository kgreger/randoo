import { gpx } from "@tmcw/togeojson";

export type LatLon = [number, number];

/** Parse a GPX file client-side into one line per recorded segment, for map preview only.
 *
 * A segment break is a real gap in recording (a paused ride, a lost GPS fix), and the
 * two sides of it can be far apart, so segments are kept separate rather than joined into
 * one line: drawing a straight connector across a gap would show a route the rider never
 * actually rode.
 */
export async function parseGpxPreview(file: File): Promise<LatLon[][]> {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const geojson = gpx(doc);

  const segments: LatLon[][] = [];
  for (const feature of geojson.features) {
    const geometry = feature.geometry;
    if (geometry?.type === "LineString") {
      segments.push(geometry.coordinates.map(([lon, lat]) => [lat, lon] as LatLon));
    } else if (geometry?.type === "MultiLineString") {
      for (const line of geometry.coordinates) {
        segments.push(line.map(([lon, lat]) => [lat, lon] as LatLon));
      }
    }
  }
  return segments;
}

/** The name the file gives its course: the first track's name, else the file's own. */
export async function parseGpxCourseName(file: File): Promise<string | null> {
  const doc = new DOMParser().parseFromString(await file.text(), "application/xml");
  const nameOf = (element: Element | undefined) =>
    Array.from(element?.children ?? [])
      .find((child) => child.localName === "name")
      ?.textContent?.trim() || null;
  const tracks = Array.from(doc.getElementsByTagName("trk"));
  const metadata = Array.from(doc.getElementsByTagName("metadata"));
  return nameOf(tracks[0]) ?? nameOf(metadata[0]);
}

/** A waypoint the file already carries, such as a brevet's control point. */
export interface RouteWaypoint {
  id: string;
  name: string | null;
  description: string | null;
  lat: number;
  lon: number;
  // Set for the start and end of the route that Randoo adds itself: the type
  // such a point always has (it is not in the file, so it is neither exported
  // nor tickable).
  fixedType?: string;
}

// Matches the <src> Randoo writes into the waypoints it generates (see
// backend/randoo/gpx.py), so a file exported by Randoo and loaded again does
// not show those as the rider's own waypoints.
const RANDOO_SOURCE = "Randoo";

/** The top-level waypoints of a GPX file, in file order, for showing on the
 * map and in the list. */
export async function parseGpxWaypoints(file: File): Promise<RouteWaypoint[]> {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const waypoints: RouteWaypoint[] = [];
  for (const element of Array.from(doc.querySelectorAll("wpt"))) {
    if (element.parentElement?.localName !== "gpx") continue;
    const childText = (name: string) =>
      Array.from(element.children).find((child) => child.localName === name)?.textContent?.trim() || null;
    if (childText("src") === RANDOO_SOURCE) continue;
    const lat = Number(element.getAttribute("lat"));
    const lon = Number(element.getAttribute("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    waypoints.push({
      id: `wpt:${waypoints.length}`,
      name: childText("name"),
      description: childText("desc") ?? childText("cmt"),
      lat,
      lon,
    });
  }
  return waypoints;
}
