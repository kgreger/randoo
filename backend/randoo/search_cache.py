"""Short-lived cache tying an /api/analyze result to a later /api/export call
for the same search, so export doesn't repeat the whole pipeline - including
any per-POI routing calls - that analyze just did.

Keyed purely from the request's own inputs (file content, categories,
radius, tier), not an explicit id the frontend has to pass along: export
already resends the same file and parameters, so it lands on the same key
automatically, with no protocol change needed. Kept in process memory
rather than on disk - a few minutes of freshness between analyze and export
in the same session is all this needs, unlike the Overpass response cache,
which is meant to outlive a single search.
"""

import hashlib
import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .gpx import Point
    from .poi_filter import RankedPoi

_TTL_S = 300

_cache: dict[str, tuple[float, list["RankedPoi"], list[list["Point"]]]] = {}


def make_key(file_bytes: bytes, category_ids: list[str], radius_m: float, tier: str) -> str:
    digest = hashlib.sha256()
    digest.update(file_bytes)
    digest.update("|".join(sorted(category_ids)).encode())
    digest.update(f"|{radius_m}|{tier}".encode())
    return digest.hexdigest()


def get(key: str) -> tuple[list["RankedPoi"], list[list["Point"]]] | None:
    entry = _cache.get(key)
    if entry is None:
        return None
    expires_at, ranked, segments = entry
    if time.monotonic() > expires_at:
        del _cache[key]
        return None
    return ranked, segments


def set(key: str, ranked: list["RankedPoi"], segments: list[list["Point"]]) -> None:
    _prune_expired()
    _cache[key] = (time.monotonic() + _TTL_S, ranked, segments)


def _prune_expired() -> None:
    now = time.monotonic()
    expired = [key for key, (expires_at, _, _) in _cache.items() if now > expires_at]
    for key in expired:
        del _cache[key]
