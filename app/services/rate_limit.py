from datetime import datetime, timedelta, timezone

from fastapi import Request

MAX_INTENTOS = 5
VENTANA_MINUTOS = 15
BLOQUEO_MINUTOS = 10

# Estado en memoria del proceso: alcanza para una sola instancia (como el
# plan free de Render). Si el servicio corriera en varias instancias a la
# vez, cada una llevaría su propio conteo y habría que mover esto a algo
# compartido (ej. Redis).
_intentos_fallidos: dict[str, list[datetime]] = {}
_bloqueados: dict[str, datetime] = {}
_peticiones: dict[str, list[datetime]] = {}


def _ahora() -> datetime:
    return datetime.now(timezone.utc)


def obtener_ip_cliente(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "desconocida"


def limite_excedido(clave: str, max_peticiones: int, ventana_segundos: int) -> int | None:
    # Rate limit generico de ventana deslizante. Devuelve None si la
    # peticion entra dentro del limite (y la registra), o los segundos
    # que faltan para que se libere espacio si ya se supero.
    ahora = _ahora()
    ventana_inicio = ahora - timedelta(seconds=ventana_segundos)
    historial = [t for t in _peticiones.get(clave, []) if t > ventana_inicio]

    if len(historial) >= max_peticiones:
        restante = ventana_segundos - (ahora - min(historial)).total_seconds()
        return max(1, int(restante))

    historial.append(ahora)
    _peticiones[clave] = historial
    return None


def ip_bloqueada(ip: str) -> int | None:
    hasta = _bloqueados.get(ip)
    if not hasta:
        return None
    restante = (hasta - _ahora()).total_seconds()
    if restante <= 0:
        del _bloqueados[ip]
        return None
    return int(restante)


def registrar_fallo(ip: str) -> None:
    ahora = _ahora()
    ventana_inicio = ahora - timedelta(minutes=VENTANA_MINUTOS)
    intentos = [t for t in _intentos_fallidos.get(ip, []) if t > ventana_inicio]
    intentos.append(ahora)
    _intentos_fallidos[ip] = intentos
    if len(intentos) >= MAX_INTENTOS:
        _bloqueados[ip] = ahora + timedelta(minutes=BLOQUEO_MINUTOS)
        _intentos_fallidos[ip] = []


def registrar_exito(ip: str) -> None:
    _intentos_fallidos.pop(ip, None)
    _bloqueados.pop(ip, None)
