"""Build a GPX file with the route and its POIs, ready to load onto a bike computer.

The track lets the file double as the course itself, not just a list of
points to cross-reference against a separately loaded route. Each POI is
written out twice:

- once at its real position, so every device and map app shows it where it
  actually is;
- once more at the nearest point on the route itself — a synthetic "turnoff"
  marker, not a real place. Garmin Connect has been observed to silently
  drop a waypoint from its course-point view once it's more than roughly
  30-80m from the track (undocumented, and the exact cutoff isn't known),
  presumably because it tries to snap waypoints onto the course and gives up
  past some tolerance. Sitting exactly on the track, the turnoff marker is
  never far enough away to hit that cutoff, whatever it actually is.

Waypoints carry two things aimed specifically at Garmin devices, since
that's the most common target and the GPX 1.1 base schema has no
proximity-alert concept of its own:

- `<sym>` with one of Garmin's own waypoint icon names, so the point shows up
  with a recognisable symbol instead of a generic pin — this part of plain
  GPX, not a Garmin extension, so most other tools honour it too.
- A `gpxx:WaypointExtension`/`Proximity` extension, which is what actually
  makes an Edge (or Basecamp, or most Garmin handhelds) pop up an
  "approaching waypoint" alert as you ride past. Devices that don't
  understand this extension just ignore it, same as any other GPX consumer
  faced with a foreign `<extensions>` element — no code path in this file
  breaks output for non-Garmin devices.

Everything here is inferred from Garmin's public GPX Extensions v3 schema and
GPX files it's known to produce, not verified against a real device or
Garmin Connect import — if the on-device alert doesn't fire, this is the
first place to check.
"""

import xml.etree.ElementTree as ET

import gpxpy
import gpxpy.gpx

from .gpx import Point
from .poi_filter import RankedPoi

GARMIN_GPXX_NS = "http://www.garmin.com/xmlschemas/GpxExtensions/v3"

# How close the rider needs to get to a waypoint itself (not the route) to
# trigger a device's proximity alert. Independent of the search radius that
# picked out the POIs in the first place — that one controls how far off the
# route a POI is allowed to be, this one controls how reliably the alert
# actually fires as you pass, given GPS drift and the point sitting some
# distance off the road. Fixed for now rather than derived per POI.
GARMIN_PROXIMITY_M = 150.0

# Garmin's own waypoint icon names (as used by Basecamp/Garmin Connect and
# recognised by Edge/handheld devices) closest to each Randoo category. Where
# there's no good specific match, a plain coloured flag at least tells
# categories apart on the map rather than mislabelling one.
GARMIN_SYMBOLS: dict[str, str] = {
    "water": "Drinking Water",
    "fuel": "Gas Station",
    "bike_shop": "Flag, Blue",
    "lodging": "Lodging",
    "hut": "Campground",
    "food": "Restaurant",
    "rest": "Picnic Area",
}


def build_gpx(ranked_pois: list[RankedPoi], segments: list[list[Point]]) -> str:
    gpx = gpxpy.gpx.GPX()
    gpx.nsmap["gpxx"] = GARMIN_GPXX_NS

    for segment in segments:
        if not segment:
            continue
        track_segment = gpxpy.gpx.GPXTrackSegment()
        track_segment.points = [gpxpy.gpx.GPXTrackPoint(p.lat, p.lon) for p in segment]
        if not gpx.tracks:
            gpx.tracks.append(gpxpy.gpx.GPXTrack())
        gpx.tracks[0].segments.append(track_segment)

    for ranked in ranked_pois:
        gpx.waypoints.append(_poi_waypoint(ranked))
        gpx.waypoints.append(_turnoff_waypoint(ranked))

    return gpx.to_xml()


def _poi_waypoint(ranked: RankedPoi) -> gpxpy.gpx.GPXWaypoint:
    poi = ranked.poi
    wpt = gpxpy.gpx.GPXWaypoint(
        latitude=poi.lat,
        longitude=poi.lon,
        name=poi.name or poi.category_id,
        comment=f"{poi.category_id} · {round(ranked.distance_to_route_m)} m from route",
        symbol=GARMIN_SYMBOLS.get(poi.category_id),
    )
    wpt.extensions.append(_garmin_proximity_extension(GARMIN_PROXIMITY_M))
    return wpt


def _turnoff_waypoint(ranked: RankedPoi) -> gpxpy.gpx.GPXWaypoint:
    """A synthetic marker sitting exactly on the route, at the point closest
    to the real POI — see the module docstring for why this exists."""
    poi = ranked.poi
    on_route = ranked.nearest_route_point
    wpt = gpxpy.gpx.GPXWaypoint(
        latitude=on_route.lat,
        longitude=on_route.lon,
        name=f"{poi.name or poi.category_id} (turnoff)",
        comment=f"{poi.category_id} · actual spot {round(ranked.distance_to_route_m)} m off-route here",
        symbol=GARMIN_SYMBOLS.get(poi.category_id),
    )
    wpt.extensions.append(_garmin_proximity_extension(GARMIN_PROXIMITY_M))
    return wpt


def _garmin_proximity_extension(proximity_m: float) -> ET.Element:
    extension = ET.Element(f"{{{GARMIN_GPXX_NS}}}WaypointExtension")
    proximity = ET.SubElement(extension, f"{{{GARMIN_GPXX_NS}}}Proximity")
    proximity.text = str(proximity_m)
    return extension
