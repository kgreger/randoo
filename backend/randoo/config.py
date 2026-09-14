import os

from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")

# Path to a locally maintained POI Parquet file (see the randoo-infra
# repository). Unset by default, which keeps every search on the free-tier
# Overpass path; set this to try the local path before real tier-gating
# exists.
LOCAL_POI_PARQUET_PATH = os.environ.get("RANDOO_LOCAL_POI_PARQUET_PATH")
