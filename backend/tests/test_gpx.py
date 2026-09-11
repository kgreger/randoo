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

# A paused-and-resumed recording — two segments, the kind a rider produces by
# stopping at a rest stop and picking the recording back up later.
TWO_SEGMENT_TRACK = b"""<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <trkseg>
      <trkpt lat="48.0" lon="8.0"></trkpt>
      <trkpt lat="48.01" lon="8.01"></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="49.0" lon="9.0"></trkpt>
      <trkpt lat="49.01" lon="9.01"></trkpt>
    </trkseg>
  </trk>
</gpx>
"""

EMPTY_GPX = b"""<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"></gpx>
"""


def test_parse_track_extracts_points():
    segments = parse_track(SAMPLE_TRACK)
    assert len(segments) == 1
    assert len(segments[0]) == 3
    assert segments[0][0].lat == 48.0
    assert segments[0][0].lon == 8.0


def test_parse_track_keeps_segments_separate():
    segments = parse_track(TWO_SEGMENT_TRACK)
    assert len(segments) == 2
    assert [len(s) for s in segments] == [2, 2]
    # the gap between segments isn't bridged into one continuous list
    assert segments[0][-1].lat == 48.01
    assert segments[1][0].lat == 49.0


def test_parse_track_rejects_empty_gpx():
    with pytest.raises(InvalidGpxError):
        parse_track(EMPTY_GPX)


def test_parse_track_rejects_garbage():
    with pytest.raises(InvalidGpxError):
        parse_track(b"not xml at all")
