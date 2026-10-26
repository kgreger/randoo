# Randoo

Find water, food, fuel, bike shops, and places to sleep along a planned cycling route. Built for brevets, ultra-distance races, and long tours where knowing what's ahead actually matters.

Upload a GPX track, pick the categories you care about, and Randoo pulls matching points of interest from OpenStreetMap within a chosen distance of your route. View them on a map, browse them as a list, or export them straight back into a GPX file as waypoints.

## Status

Beta. Running at [demo.konstantingreger.net/randoo](https://demo.konstantingreger.net/randoo/). You can use the search without an account; exporting needs one. Premium and beta accounts additionally get faster searches from a local copy of the OpenStreetMap data, bike-routed connections to each point, and saved plans. The interface is available in English and German and works on phones. Feature requests and bug reports go to the [ideas board](https://demo.konstantingreger.net/ideas/?project=randoo).

## How it works

1. Upload a GPX track in the browser.
2. The backend parses it and builds a buffer around the route (straight-line distance).
3. It finds OpenStreetMap points of interest inside that buffer for the categories you selected, either through the Overpass API or, for premium accounts, from a local Parquet copy of the data.
4. Each point gets a connection from the route to it: a straight line, or for premium accounts a path routed by a self-hosted [BRouter](https://github.com/abrensch/brouter).
5. Results come back as a map layer and a list in route order. Untick points you don't want, then export the rest as GPX waypoints next to the track.
6. Premium and beta accounts can save a result as a plan. A route can have several plans, each keeping its categories, radius, points and selection.

## Stack

- **Backend:** Python, FastAPI, gpxpy, Shapely, pyproj, httpx, DuckDB
- **Frontend:** React, Vite, TypeScript, Leaflet, react-i18next
- **Accounts and data:** Supabase (auth, Postgres, Edge Functions; schema in `supabase/schema.sql`)
- **Map data:** OpenStreetMap, routing by BRouter

Related repositories: `randoo-infra` builds the local POI data and the BRouter segments, `idea-portal` is the ideas board.

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

To cut a release, set the new version in `frontend/package.json` and `backend/pyproject.toml` (the same number in both) as part of a pull request. Once it is merged, the `Release` workflow creates the tag `vx.y.z` and a GitHub Release with generated notes (marked as a pre-release while the major version is 0). Labels on the merged pull requests sort them into sections (`enhancement`, `bug`); pull requests labelled `documentation` or `release` are left out, see `.github/release.yml`. A release can also be created by hand on GitHub: new release, tag `vx.y.z` on `main`, "Generate release notes".

The running version is shown in the footer of the app and returned by `/health`.

## Data & attribution

POI data comes from [OpenStreetMap](https://www.openstreetmap.org/copyright), licensed under the ODbL. Any map view or export containing OSM data must carry the "© OpenStreetMap contributors" attribution.

## License

AGPL-3.0, see [LICENSE](LICENSE). If you run a modified version of Randoo as a network service, you're required to make your changes available to its users.
