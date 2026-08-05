import asyncio
import logging

import httpx

from app.config import OPENWEATHER_API_KEY

logger = logging.getLogger(__name__)

FORECAST_URL = "https://api.openweathermap.org/data/2.5/forecast"


def _emoji_por_id(id_clima: int) -> str:
    if 200 <= id_clima < 300:
        return "⛈️"
    if 300 <= id_clima < 400:
        return "🌦️"
    if 500 <= id_clima < 600:
        return "🌧️"
    if 600 <= id_clima < 700:
        return "❄️"
    if 700 <= id_clima < 800:
        return "🌫️"
    if id_clima == 800:
        return "☀️"
    if 801 <= id_clima <= 802:
        return "🌤️"
    if id_clima >= 803:
        return "☁️"
    return "❓"


def _entrada_mas_cercana_a_mediodia(entradas: list[dict]) -> dict:
    def distancia_mediodia(entrada: dict) -> int:
        hora = int(entrada["dt_txt"].split(" ")[1].split(":")[0])
        return abs(hora - 12)

    return min(entradas, key=distancia_mediodia)


async def get_clima(lat: float, lng: float, fecha: str, intentos: int = 2) -> dict | None:
    params = {
        "lat": lat,
        "lon": lng,
        "appid": OPENWEATHER_API_KEY,
        "units": "metric",
        "lang": "es",
    }

    for intento in range(intentos):
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(FORECAST_URL, params=params)
        except httpx.HTTPError as error:
            logger.warning(
                "Fallo al llamar a OpenWeatherMap (intento %s/%s): %s",
                intento + 1,
                intentos,
                error,
            )
            resp = None

        if resp is not None:
            if resp.status_code == 200:
                datos = resp.json()
                entradas = [
                    e for e in datos.get("list", []) if e["dt_txt"].startswith(fecha)
                ]
                if not entradas:
                    return None

                temp_max = max(e["main"]["temp_max"] for e in entradas)
                temp_min = min(e["main"]["temp_min"] for e in entradas)
                precipitacion_mm = sum(
                    e.get("rain", {}).get("3h", 0) + e.get("snow", {}).get("3h", 0)
                    for e in entradas
                )
                representativa = _entrada_mas_cercana_a_mediodia(entradas)
                condicion = representativa["weather"][0]

                return {
                    "fecha": fecha,
                    "temp_max": round(temp_max, 1),
                    "temp_min": round(temp_min, 1),
                    "precipitacion_mm": round(precipitacion_mm, 1),
                    "descripcion": condicion["description"].capitalize(),
                    "emoji": _emoji_por_id(condicion["id"]),
                }

            logger.warning(
                "OpenWeatherMap respondió %s (intento %s/%s): %s",
                resp.status_code,
                intento + 1,
                intentos,
                resp.text[:200],
            )
            if resp.status_code in (401, 429):
                # Clave inválida o cuota agotada: reintentar no sirve de nada.
                return None

        if intento < intentos - 1:
            await asyncio.sleep(1.5)

    return None
