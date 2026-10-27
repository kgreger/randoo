import type { LatLon } from "./gpxPreview";

const EARTH_RADIUS_M = 6371000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineM(a: LatLon, b: LatLon): number {
  const [lat1, lon1] = a;
  const [lat2, lon2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s));
}

/** Total route length in metres, summing point-to-point distance within each
 * segment, never across a segment break, which marks a real gap in
 * recording rather than travelled distance. */
export function routeLengthM(segments: LatLon[][]): number {
  let total = 0;
  for (const segment of segments) {
    for (let i = 1; i < segment.length; i++) {
      total += haversineM(segment[i - 1], segment[i]);
    }
  }
  return total;
}

/** Where a point falls on the route: the distance along it from the start
 * (segments in recording order, never bridged across a break) and how far the
 * point sits from the nearest stretch of it, both in metres. */
export function positionOnRoute(segments: LatLon[][], point: LatLon): { alongM: number; offM: number } {
  let travelled = 0;
  let best = { alongM: 0, offM: Infinity };
  const metresPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M;
  const metresPerDegLon = metresPerDegLat * Math.cos(toRad(point[0]));
  const toXY = (p: LatLon): [number, number] => [(p[1] - point[1]) * metresPerDegLon, (p[0] - point[0]) * metresPerDegLat];

  for (const segment of segments) {
    for (let i = 1; i < segment.length; i++) {
      const [ax, ay] = toXY(segment[i - 1]);
      const [bx, by] = toXY(segment[i]);
      const dx = bx - ax;
      const dy = by - ay;
      const lengthSq = dx * dx + dy * dy;
      // The point itself sits at the origin of this local frame.
      const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq));
      const off = Math.hypot(ax + t * dx, ay + t * dy);
      const edgeM = haversineM(segment[i - 1], segment[i]);
      if (off < best.offM) best = { alongM: travelled + t * edgeM, offM: off };
      travelled += edgeM;
    }
  }
  return best;
}
