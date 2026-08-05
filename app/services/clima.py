import asyncio
import logging

import httpx

logger = logging.getLogger(__name__)

USER_AGENT = "ViajeroWeb/1.0 (contacto@viajero.app)"
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

# Códigos WMO (weathercode) de Open-Meteo agrupados a una descripción y un emoji.
CODIGOS_CLIMA = {
    0: ("Despejado", "☀️"),
    1: ("Mayormente despejado", "🌤️"),
    2: ("Parcialmente nublado", "⛅"),
    3: ("Nublado", "☁️"),
    45: ("Neblina", "🌫️"),
    48: ("Neblina con escarcha", "🌫️"),
    51: ("Llovizna leve", "🌦️"),
    53: ("Llovizna", "🌦️"),
    55: ("Llovizna intensa", "🌦️"),
    56: ("Llovizna helada", "🌧️"),
    57: ("Llovizna helada intensa", "🌧️"),
    61: ("Lluvia leve", "🌧️"),
    63: ("Lluvia", "🌧️"),
    65: ("Lluvia intensa", "🌧️"),
    66: ("Lluvia helada", "🌧️"),
    67: ("Lluvia helada intensa", "🌧️"),
    71: ("Nieve leve", "❄️"),
    73: ("Nieve", "❄️"),
    75: ("Nieve intensa", "❄️"),
    77: ("Granizo pequeño", "❄️"),
    80: ("Chubascos leves", "🌦️"),
    81: ("Chubascos", "🌦️"),
    82: ("Chubascos intensos", "⛈️"),
    85: ("Chubascos de nieve", "❄️"),
    86: ("Chubascos de nieve intensos", "❄️"),
    95: ("Tormenta eléctrica", "⛈️"),
    96: ("Tormenta con granizo", "⛈️"),
    99: ("Tormenta con granizo intenso", "⛈️"),
}


def _describir(codigo: int | None) -> tuple[str, str]:
    if codigo is None:
        return ("Sin datos", "❓")
    return CODIGOS_CLIMA.get(codigo, ("Desconocido", "❓"))


async def get_clima(
    lat: float, lng: float, fecha: str, intentos: int = 3
) -> dict | None:
    params = {
        "latitude": lat,
        "longitude": lng,
        "daily": "weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum",
        "timezone": "auto",
        "start_date": fecha,
        "end_date": fecha,
    }
    headers = {"User-Agent": USER_AGENT}

    for intento in range(intentos):
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.get(OPEN_METEO_URL, params=params, headers=headers)
        except httpx.HTTPError as error:
            logger.warning(
                "Fallo al llamar a Open-Meteo (intento %s/%s): %s",
                intento + 1,
                intentos,
                error,
            )
            resp = None

        if resp is not None:
            if resp.status_code == 200:
                datos = resp.json()
                diario = datos.get("daily")
                if diario and diario.get("time"):
                    codigo = diario["weathercode"][0]
                    descripcion, emoji = _describir(codigo)
                    return {
                        "fecha": diario["time"][0],
                        "temp_max": diario["temperature_2m_max"][0],
                        "temp_min": diario["temperature_2m_min"][0],
                        "precipitacion_mm": diario["precipitation_sum"][0],
                        "descripcion": descripcion,
                        "emoji": emoji,
                    }
                return None
            logger.warning(
                "Open-Meteo respondió %s (intento %s/%s): %s",
                resp.status_code,
                intento + 1,
                intentos,
                resp.text[:200],
            )

        if intento < intentos - 1:
            await asyncio.sleep(1.5)

    return None
