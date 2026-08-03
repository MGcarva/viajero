from fastapi import APIRouter, HTTPException, Query

from app.services.clima import get_clima
from app.services.osm import geocode, get_nearby_pois, get_route

router = APIRouter(prefix="/api")


@router.get("/geocode")
async def api_geocode(q: str = Query(..., min_length=1)):
    resultado = await geocode(q)
    if resultado is None:
        raise HTTPException(status_code=404, detail="No se encontró esa ubicación")
    return resultado


@router.get("/route")
async def api_route(
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
):
    resultado = await get_route(origin_lat, origin_lng, dest_lat, dest_lng)
    if resultado is None:
        raise HTTPException(
            status_code=502, detail="No se pudo calcular la ruta, intentá de nuevo"
        )
    return resultado


@router.get("/pois")
async def api_pois(lat: float, lng: float, radius: int = 5000):
    return await get_nearby_pois(lat, lng, radius)


@router.get("/clima")
async def api_clima(lat: float, lng: float, fecha: str):
    resultado = await get_clima(lat, lng, fecha)
    if resultado is None:
        raise HTTPException(
            status_code=502,
            detail="No se pudo obtener el pronóstico para esa fecha (el rango disponible es de hoy a 16 días)",
        )
    return resultado
