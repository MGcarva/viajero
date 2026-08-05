from datetime import datetime, timedelta, timezone

MAX_INTENTOS = 5
VENTANA_MINUTOS = 15
BLOQUEO_MINUTOS = 10

# Estado en memoria del proceso: alcanza para una sola instancia (como el
# plan free de Render). Si el servicio corriera en varias instancias a la
# vez, cada una llevaría su propio conteo y habría que mover esto a algo
# compartido (ej. Redis).
_intentos_fallidos: dict[str, list[datetime]] = {}
_bloqueados: dict[str, datetime] = {}


def _ahora() -> datetime:
    return datetime.now(timezone.utc)


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
