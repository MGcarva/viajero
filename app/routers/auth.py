import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.config import SUPABASE_ANON_KEY, SUPABASE_URL
from app.services.rate_limit import ip_bloqueada, registrar_exito, registrar_fallo

router = APIRouter(prefix="/api/auth")


class LoginBody(BaseModel):
    email: str
    password: str


def obtener_ip_cliente(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "desconocida"


@router.post("/login")
async def login(body: LoginBody, request: Request):
    ip = obtener_ip_cliente(request)

    restante = ip_bloqueada(ip)
    if restante is not None:
        minutos = max(1, restante // 60)
        raise HTTPException(
            status_code=429,
            detail=f"Demasiados intentos fallidos. Probá de nuevo en {minutos} minuto{'s' if minutos != 1 else ''}.",
        )

    url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
    headers = {"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.post(
                url,
                json={"email": body.email, "password": body.password},
                headers=headers,
            )
        except httpx.HTTPError:
            raise HTTPException(
                status_code=502, detail="No se pudo conectar con el servicio de autenticación."
            )

    if resp.status_code == 200:
        registrar_exito(ip)
        datos = resp.json()
        return {
            "access_token": datos["access_token"],
            "refresh_token": datos["refresh_token"],
        }

    if resp.status_code in (400, 401):
        registrar_fallo(ip)
        raise HTTPException(status_code=401, detail="Email o contraseña incorrectos.")

    raise HTTPException(
        status_code=502, detail="No se pudo conectar con el servicio de autenticación."
    )
