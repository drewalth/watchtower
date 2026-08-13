"""Terrain viewshed computation from the open Copernicus GLO-30 DEM.

A viewshed is the ground an observer can actually *see* given the terrain in
between — a better model of "which fires can this lookout see" than a flat
circle, because ridges block the line of sight. ``compute_viewshed`` runs the
per-tower pipeline (DEM tiles → UTM mosaic → gdal_viewshed → polygonized 4326);
the numbered steps below mark each stage.

Requires the GDAL CLI (gdalbuildvrt/gdalwarp/gdal_viewshed) plus rasterio and
shapely — all present in the Docker image.
"""

import math
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

import rasterio
from django.contrib.gis.geos import GEOSGeometry, MultiPolygon
from rasterio.features import shapes
from shapely.geometry import shape
from shapely.ops import unary_union

# Copernicus GLO-30 DEM, public on AWS Open Data (no auth required).
_DEM_HOST = "https://copernicus-dem-30m.s3.amazonaws.com"
_DEM_RES_M = 30  # GLO-30 is ~30 m / 1 arc-second.


def _tile_name(lat_sw: int, lon_sw: int) -> str:
    """Copernicus COG tile name for the 1° tile with this SW corner."""
    ns = "N" if lat_sw >= 0 else "S"
    ew = "E" if lon_sw >= 0 else "W"
    return f"Copernicus_DSM_COG_10_{ns}{abs(lat_sw):02d}_00_{ew}{abs(lon_sw):03d}_00_DEM"


def _tile_url(lat_sw: int, lon_sw: int) -> str:
    name = _tile_name(lat_sw, lon_sw)
    return f"/vsicurl/{_DEM_HOST}/{name}/{name}.tif"


def _tiles_for_bbox(west: float, south: float, east: float, north: float) -> list[str]:
    """The /vsicurl URLs of every 1° DEM tile overlapping the bbox."""
    urls = []
    for lat_sw in range(math.floor(south), math.floor(north) + 1):
        for lon_sw in range(math.floor(west), math.floor(east) + 1):
            urls.append(_tile_url(lat_sw, lon_sw))
    return urls


def _utm_srid(lon: float, lat: float) -> int:
    """WGS84/UTM SRID for a lon/lat point, supporting both hemispheres."""
    zone = int((lon + 180) // 6) + 1
    return (32600 if lat >= 0 else 32700) + zone


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    """Run a GDAL CLI command, raising with stderr on failure."""
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"command failed ({' '.join(cmd[:1])}): {result.stderr.strip()[:500]}")
    return result


def compute_viewshed(tower, mast_height_m: float = 10.0) -> Optional[MultiPolygon]:
    """Return the tower's viewshed as a 4326 MultiPolygon (or None if empty).

    ``mast_height_m`` is the observer height above the DEM ground surface; the
    DEM supplies the actual ground elevation at the tower, which is more accurate
    than trusting the stored ``elevation_m``.
    """
    lon, lat = tower.location.x, tower.location.y
    radius_m = tower.coverage_radius_km * 1000

    # Area of interest: tower ± radius, in degrees, padded a little.
    deg_lat = radius_m / 111_320
    deg_lon = deg_lat / max(math.cos(math.radians(lat)), 0.1)
    west, east = lon - deg_lon, lon + deg_lon
    south, north = lat - deg_lat, lat + deg_lat

    utm = _utm_srid(lon, lat)
    # Observer position in the DEM's (UTM) CRS.
    observer = tower.location.clone()
    observer.transform(utm)

    with tempfile.TemporaryDirectory() as tmp:
        work_dir = Path(tmp)
        vrt = work_dir / "dem.vrt"
        dem_utm = work_dir / "dem_utm.tif"
        visible = work_dir / "visible.tif"

        # 1+2. Mosaic the relevant DEM tiles, then warp/clip to UTM metres.
        _run(["gdalbuildvrt", str(vrt), *_tiles_for_bbox(west, south, east, north)])
        _run(
            [
                "gdalwarp",
                "-t_srs",
                f"EPSG:{utm}",
                "-te",
                str(west),
                str(south),
                str(east),
                str(north),
                "-te_srs",
                "EPSG:4326",
                "-tr",
                str(_DEM_RES_M),
                str(_DEM_RES_M),
                "-r",
                "bilinear",
                "-of",
                "GTiff",
                "-overwrite",
                str(vrt),
                str(dem_utm),
            ]
        )

        # 3. Viewshed from the observer, capped at the coverage radius.
        _run(
            [
                "gdal_viewshed",
                "-ox",
                str(observer.x),
                "-oy",
                str(observer.y),
                "-oz",
                str(mast_height_m),
                "-md",
                str(radius_m),
                "-of",
                "GTiff",
                str(dem_utm),
                str(visible),
            ]
        )

        # 4. Polygonize the visible cells (value 255) and union them.
        with rasterio.open(visible) as src:
            band = src.read(1)
            mask = band == 255
            polys = [
                shape(geom)
                for geom, value in shapes(band, mask=mask, transform=src.transform)
                if value == 255
            ]

    if not polys:
        return None

    merged = unary_union(polys)  # in UTM metres
    geom = GEOSGeometry(merged.wkt, srid=utm)
    geom.transform(4326)  # back to lat/lon for storage/serving
    if geom.geom_type == "Polygon":
        geom = MultiPolygon(geom)
    return geom
