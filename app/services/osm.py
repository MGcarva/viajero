import asyncio

import httpx

USER_AGENT = "ViajeroWeb/1.0 (contacto@viajero.app)"

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
OSRM_URL = "https://router.project-osrm.org/route/v1/driving"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

TIPOS_OVERPASS = {
    ("amenity", "fuel"): "gasolinera",
    ("tourism", "hotel"): "hotel",
    ("shop", "car_repair"): "mecanico",
    ("shop", "motorcycle_repair"): "mecanico",
    ("amenity", "hospital"): "hospital",
    ("amenity", "restaurant"): "restaurante",
}


async def geocode(query: str) -> dict | None:
    params = {"q": query, "format": "json", "limit": 1}
    headers = {"User-Agent": USER_AGENT}

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.get(NOMINATIM_URL, params=params, headers=headers)
        except httpx.HTTPError:
            return None

    if resp.status_code != 200:
        return None

    resultados = resp.json()
    if not resultados:
        return None

    primero = resultados[0]
    return {
        "latitude": float(primero["lat"]),
        "longitude": float(primero["lon"]),
        "label": primero.get("display_name", query),
    }


async def get_route(
    origin_lat: float, origin_lng: float, dest_lat: float, dest_lng: float
) -> dict | None:
    url = f"{OSRM_URL}/{origin_lng},{origin_lat};{dest_lng},{dest_lat}"
    params = {"overview": "full", "geometries": "geojson"}

    async with httpx.AsyncClient(timeout=15) as client:
        try:
            resp = await client.get(url, params=params)
        except httpx.HTTPError:
            return None

    if resp.status_code != 200:
        return None

    datos = resp.json()
    if datos.get("code") != "Ok" or not datos.get("routes"):
        return None

    ruta = datos["routes"][0]
    coordenadas = [[lat, lng] for lng, lat in ruta["geometry"]["coordinates"]]

    return {
        "coordinates": coordenadas,
        "distancia_km": round(ruta["distance"] / 1000, 1),
    }


def _clasificar_poi(tags: dict) -> str:
    for (clave, valor), tipo in TIPOS_OVERPASS.items():
        if tags.get(clave) == valor:
            return tipo
    return "otro"


def _clausula_around(puntos: list[tuple[float, float]], radius: int) -> str:
    # Overpass acepta más de un par lat,lon en "around": en ese caso busca
    # cerca de CUALQUIERA de los puntos, ideal para cubrir un camino entero
    # en una sola consulta en vez de una por punto.
    coords = ",".join(f"{lat},{lng}" for lat, lng in puntos)
    return f"around:{radius},{coords}"


def _construir_query_overpass(clausula: str) -> str:
    filtros = "".join(
        f'node["{clave}"="{valor}"]({clausula});\n' for clave, valor in TIPOS_OVERPASS
    )
    return f"[out:json][timeout:25];\n({filtros});\nout center;"


async def _ejecutar_overpass(clausula: str, intentos: int = 2) -> list[dict]:
    query = _construir_query_overpass(clausula)
    headers = {"User-Agent": USER_AGENT}

    for intento in range(intentos):
        async with httpx.AsyncClient(timeout=30) as client:
            try:
                resp = await client.post(
                    OVERPASS_URL, data={"data": query}, headers=headers
                )
            except httpx.HTTPError:
                resp = None

        if resp is not None and resp.status_code == 200:
            try:
                datos = resp.json()
            except ValueError:
                datos = None
            if datos is not None:
                return [
                    {
                        "id": elemento["id"],
                        "nombre": elemento.get("tags", {}).get("name", "Sin nombre"),
                        "tipo": _clasificar_poi(elemento.get("tags", {})),
                        "latitude": elemento["lat"],
                        "longitude": elemento["lon"],
                    }
                    for elemento in datos.get("elements", [])
                ]

        if intento < intentos - 1:
            await asyncio.sleep(2)

    return []


async def get_nearby_pois(
    lat: float, lng: float, radius: int = 5000, intentos: int = 2
) -> list[dict]:
    return await _ejecutar_overpass(_clausula_around([(lat, lng)], radius), intentos)


def _submuestrear(puntos: list[tuple[float, float]], maximo: int) -> list[tuple[float, float]]:
    if len(puntos) <= maximo:
        return puntos
    paso = (len(puntos) - 1) / (maximo - 1)
    return [puntos[round(i * paso)] for i in range(maximo)]


async def get_pois_along_route(
    puntos: list[tuple[float, float]], radius: int = 3000, intentos: int = 2
) -> list[dict]:
    if not puntos:
        return []
    muestra = _submuestrear(puntos, maximo=12)
    return await _ejecutar_overpass(_clausula_around(muestra, radius), intentos)
