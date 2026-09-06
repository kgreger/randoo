import { gpx } from "@tmcw/togeojson";

export type LatLon = [number, number];

/** Parse a GPX file client-side into a line of [lat, lon] pairs, for map preview only. */
export async function parseGpxPreview(file: File): Promise<LatLon[]> {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const geojson = gpx(doc);

  const coords: LatLon[] = [];
  for (const feature of geojson.features) {
    if (feature.geometry?.type === "LineString") {
      for (const [lon, lat] of feature.geometry.coordinates) {
        coords.push([lat, lon]);
      }
    }
  }
  return coords;
}
