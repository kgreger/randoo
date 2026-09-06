import pytest

from randoo.gpx import InvalidGpxError, parse_track

SAMPLE_TRACK = b"""<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>
    <trkpt lat="48.0" lon="8.0"></trkpt>
    <trkpt lat="48.01" lon="8.01"></trkpt>
    <trkpt lat="48.02" lon="8.02"></trkpt>
  </trkseg></trk>
</gpx>
"""

EMPTY_GPX = b"""<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"></gpx>
"""


def test_parse_track_extracts_points():
    points = parse_track(SAMPLE_TRACK)
    assert len(points) == 3
    assert points[0].lat == 48.0
    assert points[0].lon == 8.0


def test_parse_track_rejects_empty_gpx():
    with pytest.raises(InvalidGpxError):
        parse_track(EMPTY_GPX)


def test_parse_track_rejects_garbage():
    with pytest.raises(InvalidGpxError):
        parse_track(b"not xml at all")
