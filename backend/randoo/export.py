"""Build a GPX file with POIs written out as waypoints."""

import gpxpy
import gpxpy.gpx

from .poi_filter import RankedPoi


def build_gpx(ranked_pois: list[RankedPoi]) -> str:
    gpx = gpxpy.gpx.GPX()

    for ranked in ranked_pois:
        poi = ranked.poi
        wpt = gpxpy.gpx.GPXWaypoint(
            latitude=poi.lat,
            longitude=poi.lon,
            name=poi.name or poi.category_id,
            comment=f"{poi.category_id} · {round(ranked.distance_to_route_m)} m from route",
        )
        gpx.waypoints.append(wpt)

    return gpx.to_xml()
