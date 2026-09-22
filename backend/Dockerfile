# Randoo's backend has no compiled system dependency (shapely/pyproj/duckdb
# all ship prebuilt wheels for this platform) - a plain slim Python image
# and pip install is enough, no build-essential/GDAL stage needed the way
# randoo-infra or h3-solar-poc need for osmium/GDAL.
FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml ./
COPY randoo ./randoo
RUN pip install --no-cache-dir .

EXPOSE 8000
CMD ["uvicorn", "randoo.main:app", "--host", "0.0.0.0", "--port", "8000"]
