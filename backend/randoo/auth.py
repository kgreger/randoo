"""Verifies Supabase session tokens for endpoints that require sign-in.

Supabase signs access tokens asymmetrically by default now (ES256/RS256), so
we verify against its published JWKS rather than needing a shared secret.
"""

import jwt
from fastapi import Header, HTTPException
from jwt import PyJWKClient

from .config import SUPABASE_URL

_jwks_client: PyJWKClient | None = None


def _jwks() -> PyJWKClient:
    global _jwks_client
    if not SUPABASE_URL:
        raise HTTPException(500, "SUPABASE_URL is not configured on the server")
    if _jwks_client is None:
        _jwks_client = PyJWKClient(f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json")
    return _jwks_client


def _extract_token(authorization: str | None) -> str | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    return authorization.removeprefix("Bearer ")


def _decode(token: str) -> dict:
    signing_key = _jwks().get_signing_key_from_jwt(token)
    return jwt.decode(
        token, signing_key.key, algorithms=["ES256", "RS256"], audience="authenticated"
    )


def require_user(authorization: str | None = Header(None)) -> dict:
    """FastAPI dependency: 401s unless the request carries a valid Supabase session."""
    token = _extract_token(authorization)
    if not token:
        raise HTTPException(401, "sign-in required")
    try:
        return _decode(token)
    except jwt.PyJWTError as exc:
        raise HTTPException(401, f"invalid session: {exc}") from exc


def bearer_token(authorization: str | None = Header(None)) -> str | None:
    """FastAPI dependency: the raw bearer token if present, unverified, with
    no requirement to be signed in at all.

    Used where a request should work fully anonymously but a signed-in
    caller's own token still needs forwarding on, to Supabase's REST API for
    a tier lookup (see entitlements.py), where Row Level Security scopes it
    to that user's own row. Verifying the token ourselves first would only
    duplicate a check that call already has to make.
    """
    return _extract_token(authorization)
