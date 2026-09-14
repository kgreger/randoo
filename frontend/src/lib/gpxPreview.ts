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
