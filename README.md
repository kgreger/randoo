# Randoo

Find water, food, fuel, bike shops, and places to sleep along a planned cycling route. Built for brevets, ultra-distance races, and long tours where knowing what's ahead actually matters.

Upload a GPX track, pick the categories you care about, and Randoo pulls matching points of interest from OpenStreetMap within a chosen distance of your route. View them on a map, browse them as a list, or export them straight back into a GPX file as waypoints.

## Status

Early, active development. The current focus is a minimal working version: GPX upload, a fixed-radius corridor search, category filtering, and GPX export. No accounts, no saved routes, no route-network buffering yet; see the roadmap in `docs/` for what's planned beyond that.

## How it works

1. Upload a GPX track in the browser.
2. The backend parses it and builds a buffer around the route (currently straight-line distance, not on-road distance).
3. It queries the Overpass API for OpenStreetMap points of interest inside that buffer, filtered by the categories you selected.
4. Results come back as a map layer and a sortable list, and can be exported as GPX waypoints.

## Stack

- **Backend:** Python, FastAPI, gpxpy, Shapely, pyproj, httpx
- **Frontend:** React, Vite, TypeScript, Leaflet
- **Data:** OpenStreetMap via the Overpass API

## Running it locally

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
uvicorn randoo.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend expects the backend at `http://localhost:8000` by default (see `frontend/.env.example`).

## Releases

Versions follow [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`, with `0.x` while the app is in beta. A new feature raises the minor number, a bug fix only the patch number. Every release is a tag named `vMAJOR.MINOR.PATCH` with a GitHub Release whose notes list the merged pull requests.

To cut a release:

1. Set the new version in `frontend/package.json` and `backend/pyproject.toml` (same number in both) in a pull request titled `Release x.y.z` and merge it.
2. On GitHub, create a new release, enter the tag `vx.y.z` on `main`, and use "Generate release notes". Labels on the merged pull requests (`feature`, `improvement`, `bug`, `skip-changelog`) sort them into sections, see `.github/release.yml`.

The running version is shown in the footer of the app and returned by `/health`.

## Data & attribution

POI data comes from [OpenStreetMap](https://www.openstreetmap.org/copyright), licensed under the ODbL. Any map view or export containing OSM data must carry the "© OpenStreetMap contributors" attribution.

## License

AGPL-3.0, see [LICENSE](LICENSE). If you run a modified version of Randoo as a network service, you're required to make your changes available to its users.
