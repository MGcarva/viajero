import asyncio
import logging
from datetime import datetime, timedelta, timezone

import httpx

from app.config import OPENWEATHER_API_KEY

logger = logging.getLogger(__name__)

FORECAST_URL = "https://api.openweathermap.org/data/2.5/forecast"


def _fecha_local(timestamp_utc: int, offset_segundos: int) -> datetime:
    # OpenWeatherMap devuelve los horarios en UTC; hay que correrlos a la
    # hora local del lugar antes de comparar contra la fecha que eligió el
    # usuario (si no, cerca de la medianoche UTC un "hoy" local puede no
    # matchear ningún bloque y devolver "sin datos" aunque el pronóstico
    # exista).
    return datetime.fromtimestamp(timestamp_utc, tz=timezone.utc) + timedelta(
        seconds=offset_segundos
    )


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


def _entrada_mas_cercana_a_mediodia(entradas: list[tuple[dict, datetime]]) -> dict:
    return min(entradas, key=lambda par: abs(par[1].hour - 12))[0]


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
                offset_segundos = datos.get("city", {}).get("timezone", 0)
                entradas_del_dia = [
                    (e, hora_local)
                    for e in datos.get("list", [])
                    if (hora_local := _fecha_local(e["dt"], offset_segundos)).strftime(
                        "%Y-%m-%d"
                    )
                    == fecha
                ]
                if not entradas_del_dia:
                    return None

                temp_max = max(e["main"]["temp_max"] for e, _ in entradas_del_dia)
                temp_min = min(e["main"]["temp_min"] for e, _ in entradas_del_dia)
                precipitacion_mm = sum(
                    e.get("rain", {}).get("3h", 0) + e.get("snow", {}).get("3h", 0)
                    for e, _ in entradas_del_dia
                )
                representativa = _entrada_mas_cercana_a_mediodia(entradas_del_dia)
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
