import type { LatLon } from "./gpxPreview";

const EARTH_RADIUS_M = 6371000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineM(a: LatLon, b: LatLon): number {
  const [lat1, lon1] = a;
  const [lat2, lon2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s));
}

/** Total route length in metres, summing point-to-point distance. */
export function routeLengthM(route: LatLon[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    total += haversineM(route[i - 1], route[i]);
  }
  return total;
}
