import { useEffect, useRef } from "react";
import L from "leaflet";
import type { LatLon } from "../lib/gpxPreview";
import type { Poi } from "../lib/api";

// Close enough to make out individual streets, without zooming in so far
// that the point of the search radius (context around the POI) is lost.
const FOCUS_ZOOM = 16;

interface Props {
  route: LatLon[][];
  pois: Poi[];
  excludedIds?: Set<string>;
  focusRequest?: { poi: Poi; nonce: number } | null;
}

export function MapView({ route, pois, excludedIds, focusRequest }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  // Two separate groups, not one: redrawing POI markers (say, after a
  // checkbox toggle) must never touch the route layer, or fitBounds below
  // would re-run and snap the view back out of whatever the rider just
  // focused in on.
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const poiLayerRef = useRef<L.LayerGroup | null>(null);
  // The button reads this at click time rather than closing over `route`
  // directly - it's created once, in the init effect below, while `route`
  // keeps changing on every render.
  const routeBoundsRef = useRef<L.LatLngBounds | null>(null);
  const fitButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Default view before a route is loaded. Fixed to Düsseldorf for now;
    // centering on the signed-in user's home location is a later step.
    const map = L.map(containerRef.current, { attributionControl: true, zoomControl: false }).setView(
      [51.2277, 6.7735],
      12,
    );
    L.control.zoom({ position: "bottomright" }).addTo(map);

    // A custom control next to the zoom buttons - only shown once a route
    // is loaded (toggled in the route effect below, not here, since that's
    // where the current route's bounds are actually known).
    const FitRouteControl = L.Control.extend({
      onAdd: () => {
        const button = L.DomUtil.create("button", "map-fit-route-btn");
        button.type = "button";
        button.title = "Zoom to route";
        button.setAttribute("aria-label", "Zoom to route");
        button.innerHTML =
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>' +
          "</svg>";
        button.hidden = true;
        L.DomEvent.disableClickPropagation(button);
        button.addEventListener("click", () => {
          if (routeBoundsRef.current) map.fitBounds(routeBoundsRef.current, { padding: [40, 40] });
        });
        fitButtonRef.current = button;
        return button;
      },
    });
    new FitRouteControl({ position: "bottomright" }).addTo(map);

    // Standard OSM tiles, darkened with a CSS filter (see .map-tiles-dark in
    // styles.css) rather than a separate dark-tile provider: CARTO's free
    // dark basemap now needs an API key to drop its watermark, and this
    // needs neither a key nor a second data source.
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
      className: "map-tiles-dark",
    }).addTo(map);

    mapRef.current = map;
    routeLayerRef.current = L.layerGroup().addTo(map);
    poiLayerRef.current = L.layerGroup().addTo(map);

    // The container's real size can settle after this runs (web fonts loading,
    // flex layout reflow), and Leaflet has no way to notice on its own, it
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
    const layer = routeLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    // Each recorded segment gets its own line, never connected to the next:
    // a segment break is a real gap in the ride, not a road the rider took.
    const segmentLines = route
      .filter((segment) => segment.length > 1)
      .map((segment) => {
        // A soft wide halo under the actual line: a plain 3px stroke got lost
        // against the map tiles, especially over busy or light-toned areas.
        L.polyline(segment, { color: "#ff8f6b", weight: 10, opacity: 0.28 }).addTo(layer);
        return L.polyline(segment, { color: "#ff8f6b", weight: 5, opacity: 1 }).addTo(layer);
      });

    if (segmentLines.length > 0) {
      const bounds = segmentLines[0].getBounds();
      for (const line of segmentLines.slice(1)) bounds.extend(line.getBounds());
      map.fitBounds(bounds, { padding: [40, 40] });
      routeBoundsRef.current = bounds;
    } else {
      routeBoundsRef.current = null;
    }

    if (fitButtonRef.current) fitButtonRef.current.hidden = segmentLines.length === 0;
  }, [route]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = poiLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    for (const poi of pois) {
      // Faded, not hidden, for a POI the rider unchecked in the list - still
      // there to reconsider, just clearly not going into the export. The
      // marker itself also switches to a hollow outline rather than just
      // dimming its same solid fill, so "excluded" reads as a distinct
      // state at a glance, not just a lower-contrast version of "included".
      const excluded = excludedIds?.has(poi.id) ?? false;
      const fade = excluded ? 0.35 : 1;

      // The path from the route to this POI: a straight beeline unless
      // is_routed says a real bike route was found for it instead. Dashed
      // for the beeline, since it's an approximation worth reading as one
      // (and doubles as a way to see where free-tier connectors land);
      // solid for a real routed path.
      L.polyline(poi.connector_path, {
        color: "#ffbd6b",
        weight: poi.is_routed ? 3 : 2,
        opacity: 0.85 * fade,
        dashArray: poi.is_routed ? undefined : "2 6",
      }).addTo(layer);

      L.circleMarker([poi.lat, poi.lon], {
        radius: 7,
        color: "#241a30",
        weight: 2,
        fillColor: "#ff8f6b",
        opacity: fade,
        fillOpacity: excluded ? 0 : fade,
        dashArray: excluded ? "2 3" : undefined,
      })
        .bindPopup(`<b>${poi.name ?? poi.category_id}</b><br>${Math.round(poi.distance_to_route_m)} m from route`)
        .addTo(layer);
    }
  }, [pois, excludedIds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusRequest) return;
    map.setView([focusRequest.poi.lat, focusRequest.poi.lon], Math.max(map.getZoom(), FOCUS_ZOOM));
  }, [focusRequest]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
