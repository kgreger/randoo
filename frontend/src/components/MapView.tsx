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

    const map = L.map(containerRef.current, { attributionControl: true }).setView(
      [47.999, 7.85],
      12,
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);

    return () => {
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
      const polyline = L.polyline(route, { color: "#ffb35c", weight: 3 }).addTo(layer);
      map.fitBounds(polyline.getBounds(), { padding: [40, 40] });
    }

    for (const poi of pois) {
      L.circleMarker([poi.lat, poi.lon], {
        radius: 7,
        color: "#2a1740",
        weight: 2,
        fillColor: "#ffb35c",
        fillOpacity: 1,
      })
        .bindPopup(`<b>${poi.name ?? poi.category_id}</b><br>${Math.round(poi.distance_to_route_m)} m from route`)
        .addTo(layer);
    }
  }, [route, pois]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
