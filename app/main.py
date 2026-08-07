import time

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.config import SUPABASE_ANON_KEY, SUPABASE_URL
from app.routers.auth import router as auth_router
from app.routers.proxy import router as proxy_router

app = FastAPI(title="Viajero Web")

# Cambia en cada arranque del proceso (o sea, en cada deploy), así los
# archivos estáticos se sirven con una URL nueva y el navegador no se queda
# con una versión vieja en caché entre despliegues.
STATIC_VERSION = str(int(time.time()))

app.include_router(proxy_router)
app.include_router(auth_router)
app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")


def contexto_base() -> dict:
    return {
        "supabase_url": SUPABASE_URL,
        "supabase_anon_key": SUPABASE_ANON_KEY,
        "v": STATIC_VERSION,
    }


@app.get("/")
def mapa(request: Request):
    return templates.TemplateResponse(request, "mapa.html", contexto_base())


@app.get("/login")
def login(request: Request):
    return templates.TemplateResponse(request, "login.html", contexto_base())


@app.get("/registro")
def registro(request: Request):
    return templates.TemplateResponse(request, "registro.html", contexto_base())


@app.get("/recuperar")
def recuperar(request: Request):
    return templates.TemplateResponse(request, "recuperar.html", contexto_base())


@app.get("/restablecer")
def restablecer(request: Request):
    return templates.TemplateResponse(request, "restablecer.html", contexto_base())


@app.get("/rutas")
def mis_rutas(request: Request):
    return templates.TemplateResponse(request, "mis_rutas.html", contexto_base())


@app.get("/rutas/nueva")
def nueva_ruta(request: Request):
    return templates.TemplateResponse(request, "nueva_ruta.html", contexto_base())
