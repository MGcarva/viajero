from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.services.clima import get_clima
from app.services.osm import geocode, get_nearby_pois, get_pois_along_route, get_route
from app.services.rate_limit import limite_excedido, obtener_ip_cliente

router = APIRouter(prefix="/api")


def verificar_limite_proxy(request: Request) -> None:
    ip = obtener_ip_cliente(request)
    # Presupuesto compartido entre todos los proxies (geocode/route/pois/clima)
    # por IP: alcanza de sobra para uso normal (buscar una ruta hace ~5-8
    # llamadas) pero corta un flood automatizado.
    restante = limite_excedido(f"proxy:{ip}", max_peticiones=40, ventana_segundos=60)
    if restante is not None:
        raise HTTPException(
            status_code=429,
            detail=f"Demasiadas peticiones. Probá de nuevo en {restante} segundos.",
        )


@router.get("/geocode", dependencies=[Depends(verificar_limite_proxy)])
async def api_geocode(q: str = Query(..., min_length=1)):
    resultado = await geocode(q)
    if resultado is None:
        raise HTTPException(status_code=404, detail="No se encontró esa ubicación")
    return resultado


@router.get("/route", dependencies=[Depends(verificar_limite_proxy)])
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


@router.get("/pois", dependencies=[Depends(verificar_limite_proxy)])
async def api_pois(lat: float, lng: float, radius: int = 5000):
    return await get_nearby_pois(lat, lng, radius)


@router.get("/pois_ruta", dependencies=[Depends(verificar_limite_proxy)])
async def api_pois_ruta(puntos: str, radius: int = 3000):
    try:
        coordenadas = [
            (float(par.split(",")[0]), float(par.split(",")[1]))
            for par in puntos.split(";")
            if par
        ]
    except (ValueError, IndexError):
        raise HTTPException(status_code=400, detail="Formato de puntos inválido")

    return await get_pois_along_route(coordenadas, radius)


@router.get("/clima", dependencies=[Depends(verificar_limite_proxy)])
async def api_clima(lat: float, lng: float, fecha: str):
    resultado = await get_clima(lat, lng, fecha)
    if resultado is None:
        raise HTTPException(
            status_code=502,
            detail="No se pudo obtener el pronóstico para esa fecha (el rango disponible es de hoy a 5 días)",
        )
    return resultado
