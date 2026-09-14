"""Which tier a request is entitled to, and therefore which POI source answers it.

Deliberately not baked into the session token: a Supabase custom claim would
be tamper-proof, but would only refresh along with the token itself, so a
just-cancelled subscription would keep working until the next refresh.
Looked up fresh per request instead, straight from Supabase - the request's
own bearer token is forwarded as-is to its REST API, and Row Level Security
(not our own code) is what scopes the read to that caller's own row. No
service-role key needed anywhere in this backend.
"""

import httpx

from . import config

FREE = "free"
PREMIUM = "premium"

_TIMEOUT_S = 5


async def get_tier(token: str | None) -> str:
    """Looks up the caller's tier.

    Falls back to FREE on anything short of a clean "yes, premium" answer:
    no token, no Supabase configuration, a network error, an unreadable
    response, or the profile just saying so. A broken lookup should never be
    the reason a search fails outright, only the reason it's slower.
    """
    if config.FORCE_TIER:
        return config.FORCE_TIER

    if not token or not config.SUPABASE_URL or not config.SUPABASE_PUBLISHABLE_KEY:
        return FREE

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
            response = await client.get(
                f"{config.SUPABASE_URL}/rest/v1/profiles",
                params={"select": "tier"},
                headers={
                    "Authorization": f"Bearer {token}",
                    "apikey": config.SUPABASE_PUBLISHABLE_KEY,
                },
            )
        response.raise_for_status()
        rows = response.json()
    except (httpx.HTTPError, ValueError):
        return FREE

    if rows and rows[0].get("tier") == PREMIUM:
        return PREMIUM
    return FREE
