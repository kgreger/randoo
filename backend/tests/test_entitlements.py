import httpx
import pytest

from randoo import config, entitlements

# Captured before any test patches httpx.AsyncClient itself - the mock
# factory below needs the real class, not whatever it's currently patched
# to (patching "randoo.entitlements.httpx.AsyncClient" replaces it on the
# shared httpx module, so a reference taken afterward would resolve back to
# the mock and call itself).
_RealAsyncClient = httpx.AsyncClient


def _mock_async_client(handler):
    return lambda **kwargs: _RealAsyncClient(transport=httpx.MockTransport(handler), **kwargs)


@pytest.fixture(autouse=True)
def _clean_config(monkeypatch):
    monkeypatch.setattr(config, "FORCE_TIER", None)
    monkeypatch.setattr(config, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(config, "SUPABASE_PUBLISHABLE_KEY", "test-publishable-key")


async def test_get_tier_is_free_without_a_token():
    assert await entitlements.get_tier(None) == entitlements.FREE


async def test_get_tier_is_free_when_supabase_is_not_configured(monkeypatch):
    monkeypatch.setattr(config, "SUPABASE_URL", None)
    assert await entitlements.get_tier("some-token") == entitlements.FREE


async def test_get_tier_reads_premium_from_the_profile(monkeypatch):
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = dict(request.headers)
        return httpx.Response(200, json=[{"tier": "premium"}])

    monkeypatch.setattr("randoo.entitlements.httpx.AsyncClient", _mock_async_client(handler))

    tier = await entitlements.get_tier("user-token")

    assert tier == entitlements.PREMIUM
    # the caller's own token is forwarded as-is - RLS on the Supabase side is
    # what actually scopes the row, not anything this code decides
    assert captured["headers"]["authorization"] == "Bearer user-token"
    assert captured["headers"]["apikey"] == "test-publishable-key"


async def test_get_tier_treats_the_idea_portal_admin_role_as_premium(monkeypatch):
    # profiles.tier == 'admin' is the idea-portal moderator role, not a
    # separate subscription tier - it should still get premium search
    # rather than falling back to the slow, rate-limited Overpass path.
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[{"tier": "admin"}])

    monkeypatch.setattr("randoo.entitlements.httpx.AsyncClient", _mock_async_client(handler))

    assert await entitlements.get_tier("user-token") == entitlements.PREMIUM


async def test_get_tier_defaults_to_free_for_a_non_premium_profile(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[{"tier": "free"}])

    monkeypatch.setattr("randoo.entitlements.httpx.AsyncClient", _mock_async_client(handler))

    assert await entitlements.get_tier("user-token") == entitlements.FREE


async def test_get_tier_treats_beta_as_premium(monkeypatch):
    # 'beta' is a real, distinct profiles.tier value (see schema.sql's check
    # constraint), not a synonym for premium - still gets premium search too.
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[{"tier": "beta"}])

    monkeypatch.setattr("randoo.entitlements.httpx.AsyncClient", _mock_async_client(handler))

    assert await entitlements.get_tier("user-token") == entitlements.PREMIUM


async def test_get_tier_defaults_to_free_when_the_profile_row_is_missing(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[])

    monkeypatch.setattr("randoo.entitlements.httpx.AsyncClient", _mock_async_client(handler))

    assert await entitlements.get_tier("user-token") == entitlements.FREE


async def test_get_tier_defaults_to_free_on_a_supabase_error(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    monkeypatch.setattr("randoo.entitlements.httpx.AsyncClient", _mock_async_client(handler))

    assert await entitlements.get_tier("user-token") == entitlements.FREE


async def test_force_tier_skips_the_supabase_lookup_entirely(monkeypatch):
    monkeypatch.setattr(config, "FORCE_TIER", "premium")

    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("should never call Supabase when FORCE_TIER is set")

    monkeypatch.setattr("randoo.entitlements.httpx.AsyncClient", _mock_async_client(handler))

    assert await entitlements.get_tier(None) == "premium"
