import os

from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")

# The publishable (anon) key, needed alongside a request's own bearer token
# to call Supabase's REST API for a tier lookup - see entitlements.py. Not a
# secret by itself (it's the same key the frontend ships), but Row Level
# Security is what actually restricts what a call using it can read.
SUPABASE_PUBLISHABLE_KEY = os.environ.get("SUPABASE_PUBLISHABLE_KEY")

# Path to a locally maintained POI Parquet file (see the randoo-infra
# repository). Unset by default, which keeps every search on the free-tier
# Overpass path even for a premium-tier caller; set this once real premium
# data exists locally or on the server.
LOCAL_POI_PARQUET_PATH = os.environ.get("RANDOO_LOCAL_POI_PARQUET_PATH")

# Local-dev-only escape hatch: skips the Supabase tier lookup entirely and
# always answers with this tier. Never set in production - it bypasses real
# entitlement checking for everyone.
FORCE_TIER = os.environ.get("RANDOO_FORCE_TIER")

# BRouter routing endpoint for premium-tier turnoff points (see turnoff.py).
# Defaults to BRouter's own public server - a first pass, not the
# self-hosted instance planned for later. Empty/unset disables routed
# turnoffs entirely, same effect as an unconfigured local POI source.
BROUTER_URL = os.environ.get("RANDOO_BROUTER_URL", "https://brouter.de/brouter")
BROUTER_PROFILE = os.environ.get("RANDOO_BROUTER_PROFILE", "trekking")
