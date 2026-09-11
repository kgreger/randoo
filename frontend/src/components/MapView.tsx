import { useEffect, useRef } from "react";
import L from "leaflet";
import type { LatLon } from "../lib/gpxPreview";
import type { Poi } from "../lib/api";

interface Props {
  route: LatLon[];
  pois: Poi[];
}

export function MapView({ route, pois }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Default view before a route is loaded. Fixed to Düsseldorf for now —
    // centering on the signed-in user's home location is a later step.
    const map = L.map(containerRef.current, { attributionControl: true }).setView(
      [51.2277, 6.7735],
      12,
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);

    // The container's real size can settle after this runs (web fonts loading,
    // flex layout reflow), and Leaflet has no way to notice on its own — it
    // just keeps rendering at whatever size it measured on creation.
    const resizeObserver = new ResizeObserver(() => map.invalidateSize());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    if (route.length > 1) {
      const polyline = L.polyline(route, { color: "#ff8f6b", weight: 3 }).addTo(layer);
      map.fitBounds(polyline.getBounds(), { padding: [40, 40] });
    }

    for (const poi of pois) {
      L.circleMarker([poi.lat, poi.lon], {
        radius: 7,
        color: "#241a30",
        weight: 2,
        fillColor: "#ff8f6b",
        fillOpacity: 1,
      })
        .bindPopup(`<b>${poi.name ?? poi.category_id}</b><br>${Math.round(poi.distance_to_route_m)} m from route`)
        .addTo(layer);
    }
  }, [route, pois]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
