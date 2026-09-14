from fastapi.testclient import TestClient

from randoo.main import app

client = TestClient(app)

SAMPLE_GPX = b"""<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>
    <trkpt lat="48.0" lon="8.0"></trkpt>
    <trkpt lat="48.01" lon="8.01"></trkpt>
  </trkseg></trk>
</gpx>
"""


def test_export_requires_authorization_header():
    response = client.post(
        "/api/export",
        files={"file": ("route.gpx", SAMPLE_GPX, "application/gpx+xml")},
        data={"categories": "water", "radius_m": "300"},
    )
    assert response.status_code == 401


def test_export_rejects_malformed_authorization_header():
    response = client.post(
        "/api/export",
        files={"file": ("route.gpx", SAMPLE_GPX, "application/gpx+xml")},
        data={"categories": "water", "radius_m": "300"},
        headers={"Authorization": "not-a-bearer-token"},
    )
    assert response.status_code == 401


def test_analyze_does_not_require_authorization():
    # An out-of-range radius fails before any Overpass call is made, which
    # keeps this test from depending on network access; the only thing
    # being checked is that no auth is demanded.
    response = client.post(
        "/api/analyze",
        files={"file": ("route.gpx", SAMPLE_GPX, "application/gpx+xml")},
        data={"categories": "water", "radius_m": "9999"},
    )
    assert response.status_code == 400
