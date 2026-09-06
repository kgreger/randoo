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


def require_user(authorization: str | None = Header(None)) -> dict:
    """FastAPI dependency: 401s unless the request carries a valid Supabase session."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "sign-in required")

    token = authorization.removeprefix("Bearer ")
    try:
        signing_key = _jwks().get_signing_key_from_jwt(token)
        return jwt.decode(
            token, signing_key.key, algorithms=["ES256", "RS256"], audience="authenticated"
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(401, f"invalid session: {exc}") from exc
