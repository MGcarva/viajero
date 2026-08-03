# PROMPT MAESTRO: Viajero Web

Copiá todo este archivo y pegalo como primer mensaje en una sesión nueva de Claude Code (idealmente en una carpeta vacía, con git inicializado o no). Está escrito para que el asistente pueda arrancar el proyecto de punta a punta sin necesitar más contexto tuyo del que ya está acá.

---

## Contexto

Ya existe una app móvil llamada **Viajero** (React Native + Expo) — una especie de "Waze para motociclistas de larga distancia". Este prompt es para construir **la misma funcionalidad, pero como aplicación web**, reutilizando el mismo backend de datos (Supabase).

No es un proyecto desde cero conceptualmente: es un puerto a web de un sistema que ya funciona y ya fue probado. Las decisiones de stack de abajo son finales, no las cuestiones salvo que algo no compile.

## Qué hace la app

Una app tipo "Waze para motociclistas viajeros":

1. **Login / registro** de usuarios.
2. **Mapa interactivo** que muestra la ubicación del usuario.
3. **Crear rutas** (origen → destino): geocodifica ambos puntos, traza la ruta real por carretera, y muestra puntos de interés cercanos (gasolineras, hoteles, mecánicos, hospitales, restaurantes).
4. **Alertas en tiempo real** entre usuarios: accidente, pedir ayuda, peligro, control policial, clima. Reportadas por un usuario, visibles al instante para el resto sin recargar la página.
5. **Reseñas de lugares**: calificación 1-5 estrellas + comentario, tanto para lugares que vienen de OpenStreetMap como para lugares que un usuario agrega a mano (no todo tiene que existir ya en OSM).

## Stack técnico (decisiones finales)

- **Backend**: Python 3.11+, **FastAPI** + Uvicorn.
- **Frontend**: HTML + CSS + JavaScript vanilla (sin React/Vue/build step). Server-side templates con **Jinja2** para las páginas, JS plano para la interactividad.
- **Mapa**: **Leaflet.js** (CDN) + tiles de OpenStreetMap (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`). Gratis, sin API key. En la web es más simple que en la app móvil: no hace falta ningún WebView ni puente RN↔JS, Leaflet corre directo en el navegador.
- **Geocoding**: Nominatim (`https://nominatim.openstreetmap.org/search`).
- **Ruteo**: OSRM demo server (`https://router.project-osrm.org/route/v1/driving/...`).
- **POIs cercanos**: Overpass API (`https://overpass-api.de/api/interpreter`).
- **Backend de datos**: **Supabase** (Postgres + PostGIS + Auth + Realtime) — el mismo proyecto que ya usa la app móvil (o uno nuevo con el mismo esquema, ver abajo). Usar el SDK oficial `supabase-py` en el backend, y `@supabase/supabase-js` por CDN en el frontend.
- **Contenedores**: Docker (`Dockerfile` + `docker-compose.yml` para desarrollo local).
- **Control de versiones**: Git, con `.gitignore` apropiado para Python (nunca commitear `.env`, `__pycache__/`, `venv/`).

### Por qué esta división de responsabilidades

- **El navegador habla directo con Supabase** para: login/registro/logout, lectura/escritura de rutas, alertas, reseñas, y la suscripción Realtime a la tabla `alerts`. Esto es exactamente lo que ya hace la app móvil, y Supabase soporta esto de forma segura porque las tablas tienen Row Level Security (RLS) — no hace falta que el backend Python medie estas operaciones.
- **El backend Python actúa de proxy** para Nominatim, OSRM y Overpass. Esto es necesario porque:
  1. Llamarlos directo desde el navegador puede chocar con CORS.
  2. Nominatim y Overpass exigen un header `User-Agent` identificable — más fácil de garantizar centralizado en un solo lugar (ver "Lecciones aprendidas" abajo).
  3. Permite cachear/reintentar sin duplicar lógica en el frontend.

## Modelo de datos (Supabase / PostgreSQL + PostGIS)

Si vas a usar un proyecto de Supabase nuevo, corré esto en el SQL Editor. Si vas a reutilizar el proyecto de la app móvil, ya existe — no lo vuelvas a correr.

```sql
create extension if not exists postgis;

create table profiles (
  id uuid references auth.users primary key,
  username text unique not null,
  moto_modelo text,
  avatar_url text,
  created_at timestamptz default now()
);

create table routes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) not null,
  nombre text not null,
  origen text not null,
  destino text not null,
  origen_geom geography(Point, 4326) not null,
  destino_geom geography(Point, 4326) not null,
  waypoints jsonb,
  distancia_km numeric,
  created_at timestamptz default now()
);

create table pois (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('gasolinera','hotel','mecanico','hospital','restaurante','otro')),
  nombre text not null,
  ubicacion geography(Point, 4326) not null,
  fuente text default 'osm' check (fuente in ('osm','usuario')),
  agregado_por uuid references profiles(id),
  verificado boolean default false,
  osm_id bigint unique,
  created_at timestamptz default now()
);
create index pois_ubicacion_idx on pois using gist (ubicacion);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) not null,
  tipo text not null check (tipo in ('accidente','ayuda','peligro','control_policial','clima')),
  descripcion text,
  ubicacion geography(Point, 4326) not null,
  activa boolean default true,
  expira_at timestamptz default (now() + interval '6 hours'),
  created_at timestamptz default now()
);
create index alerts_ubicacion_idx on alerts using gist (ubicacion);
alter publication supabase_realtime add table alerts;

create table resenas (
  id uuid primary key default gen_random_uuid(),
  poi_id uuid references pois(id) not null,
  user_id uuid references profiles(id) not null,
  calificacion smallint not null check (calificacion between 1 and 5),
  comentario text,
  created_at timestamptz default now()
);
create index resenas_poi_id_idx on resenas (poi_id);

-- RLS: lectura pública en todo, escritura solo del dueño donde aplica.
alter table profiles enable row level security;
alter table routes enable row level security;
alter table pois enable row level security;
alter table alerts enable row level security;
alter table resenas enable row level security;

create policy "Lectura pública profiles" on profiles for select using (true);
create policy "Lectura pública routes" on routes for select using (true);
create policy "Usuarios crean sus routes" on routes for insert with check (auth.uid() = user_id);

create policy "Lectura pública pois" on pois for select using (true);
create policy "Usuarios agregan sus POIs" on pois for insert with check (auth.uid() = agregado_por);

create policy "Lectura pública alerts" on alerts for select using (true);
create policy "Usuarios crean sus alerts" on alerts for insert with check (auth.uid() = user_id);

create policy "Lectura pública de reseñas" on resenas for select using (true);
create policy "Usuarios crean sus reseñas" on resenas for insert with check (auth.uid() = user_id);
create policy "Usuarios editan sus reseñas" on resenas for update using (auth.uid() = user_id);
create policy "Usuarios borran sus reseñas" on resenas for delete using (auth.uid() = user_id);

-- Trigger: crea el perfil automáticamente al registrarse.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

## Lecciones aprendidas en la versión móvil (no las repitas)

Estas son cosas que ya nos costaron tiempo depurar en la versión React Native. Aplicá las soluciones desde el principio:

1. **Overpass API exige un header `User-Agent`** en la petición POST, o responde `406 Not Acceptable` con un body HTML (no JSON) que rompe cualquier `response.json()`. Poné siempre `User-Agent: ViajeroWeb/1.0` (o similar) en las llamadas del backend a Nominatim y Overpass.
2. **El servidor público de Overpass (`overpass-api.de`) se satura seguido y devuelve `504`**, sobre todo con rutas largas o consultas en paralelo. Mitigalo con: (a) un reintento automático tras una pausa corta, (b) consultas secuenciales en vez de paralelas cuando pidas POIs de origen y destino a la vez, y (c) que un fallo de POIs nunca tumbe la ruta completa — la ruta se debe poder mostrar y guardar igual aunque los POIs fallen.
3. **Las columnas `geography` de PostGIS no salen como JSON limpio por la API REST de Supabase (PostgREST)** — salen como hexadecimal WKB. En la app móvil esto obligó a escribir un parser manual de WKB en JS. **Acá no hace falta sufrir eso**: como el backend es Python y puede escribir el SQL directamente (via `supabase-py` con RPC, o conectando directo a Postgres), pedí las coordenadas ya convertidas con `ST_X(ubicacion::geometry)` / `ST_Y(ubicacion::geometry)`, o devolvé GeoJSON con `ST_AsGeoJSON(ubicacion)`. Si usás `supabase-py` con `.select()` normal vas a tener el mismo problema del WKB — para evitarlo, creá funciones Postgres (`rpc`) que devuelvan lat/lng ya calculados, o vistas SQL con `ST_X`/`ST_Y` como columnas separadas.
4. **No asumas que `res.ok` es true** en las llamadas a Nominatim/OSRM/Overpass — son servicios públicos gratuitos, van a fallar de vez en cuando. Verificá el status antes de parsear JSON, y dale un mensaje de error claro al usuario en vez de dejar que rompa en silencio.
5. Para insertar puntos geográficos vía SQL directo (no PostgREST), un `POINT(lon lat)` como texto plano funciona bien gracias al cast implícito de PostGIS: `ST_GeogFromText('POINT(lon lat)')` o simplemente pasarlo como string si la columna es `geography`.

## Funcionalidad esperada, pantalla por pantalla

### 1. Login / Registro (`/login`, `/registro`)
Formularios simples con email + contraseña (+ username en registro). Usan `supabase.auth.signInWithPassword` / `supabase.auth.signUp` desde el JS del navegador. Redirigen al mapa si ya hay sesión activa.

### 2. Mapa principal (`/`)
- Pide geolocalización del navegador (`navigator.geolocation.watchPosition`), con fallback a una ubicación fija si el usuario no da permiso (ej: Melipilla, Chile: `-33.6832, -71.2235`).
- Muestra el mapa Leaflet con tiles OSM, un marcador para la posición del usuario que se actualiza en vivo.
- Botón "Nueva ruta" → lleva a la pantalla de creación de rutas.
- Botón para reportar una alerta (elegís tipo, se crea en tu ubicación actual).
- Botón "Agregar lugar" (elegís tipo + nombre, se crea en tu ubicación actual, con `fuente='usuario'`).
- Si el usuario tiene una ruta guardada, se dibuja automáticamente al cargar, junto con sus POIs cercanos.
- Los marcadores de alertas activas se cargan al entrar y se actualizan **en tiempo real** vía Supabase Realtime (`supabase.channel(...).on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, ...)`), sin recargar la página.
- Tocar un marcador de POI (de OSM o agregado a mano) abre un panel/modal con el promedio de calificación, las reseñas existentes, y un formulario para dejar la tuya.

### 3. Crear ruta (`/rutas/nueva`)
- Inputs de texto para origen y destino.
- Botón "Buscar ruta" → llama a `/api/geocode` (backend) dos veces, luego `/api/route`, luego `/api/pois` (dos veces, origen y destino, en secuencia no en paralelo).
- Dibuja la ruta + POIs en un mapa Leaflet.
- Botón "Guardar ruta" → inserta en la tabla `routes` (`waypoints` como array `[[lat, lon], ...]`, igual que en la app móvil, para no depender de parsear `geography` de vuelta).

### 4. Endpoints del backend Python (proxies, sin guardar estado)

- `GET /api/geocode?q=<texto>` → llama a Nominatim con el `User-Agent` correcto, devuelve `{ latitude, longitude, label }` o 404.
- `GET /api/route?origin_lat=&origin_lng=&dest_lat=&dest_lng=` → llama a OSRM, devuelve `{ coordinates: [[lat,lng],...], distancia_km }`.
- `GET /api/pois?lat=&lng=&radius=5000` → llama a Overpass (con reintento), devuelve la lista de POIs con `{ id (osm_id), nombre, tipo, latitude, longitude }`.

Todas estas rutas son GET simples, sin autenticación (son solo proxies a servicios públicos), pero sí deberían tener rate-limiting básico o al menos timeouts razonables para no colgar el server si Overpass tarda.

## Estructura de carpetas sugerida

```
viajero-web/
├── app/
│   ├── main.py              # FastAPI app, monta rutas y estáticos
│   ├── routers/
│   │   └── proxy.py         # /api/geocode, /api/route, /api/pois
│   ├── services/
│   │   └── osm.py           # funciones geocode(), get_route(), get_nearby_pois() con reintento
│   ├── templates/
│   │   ├── base.html
│   │   ├── login.html
│   │   ├── registro.html
│   │   ├── mapa.html
│   │   └── nueva_ruta.html
│   └── static/
│       ├── css/estilos.css
│       └── js/
│           ├── supabase-client.js   # inicializa supabase-js con URL/anon key
│           ├── mapa.js              # lógica de Leaflet + alertas realtime + reseñas
│           └── nueva_ruta.js
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── .env.example
├── .gitignore
├── README.md
└── .git/
```

## Docker

`Dockerfile` (backend Python sirviendo todo, incluyendo los estáticos):

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

`docker-compose.yml` (para desarrollo local, con recarga en caliente):

```yaml
services:
  web:
    build: .
    ports:
      - "8000:8000"
    env_file:
      - .env
    volumes:
      - ./app:/app/app
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

`.env.example` (nunca commitear el `.env` real):

```
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_ANON_KEY=tu-anon-key
```

La `SUPABASE_URL` y `SUPABASE_ANON_KEY` las necesita tanto el backend (para el proxy, si valida sesión) como el frontend (para `supabase-js`) — al frontend se le inyectan vía una variable en el template Jinja (`{{ supabase_url }}`, `{{ supabase_anon_key }}`), no hay que exponer nada más sensible: la anon key está diseñada para ser pública, la seguridad real la da RLS.

## Git

```bash
git init
git add .
git commit -m "Estructura inicial del proyecto Viajero Web"
```

`.gitignore` mínimo:

```
__pycache__/
*.pyc
.env
venv/
.venv/
*.egg-info/
.DS_Store
```

No se pide crear el repo remoto ni hacer push — eso lo decide el usuario cuando esté listo.

## Orden sugerido de implementación (fases)

1. Estructura del proyecto + Dockerfile + docker-compose + FastAPI mínimo sirviendo un "hola mundo".
2. Login/registro conectado a Supabase Auth (frontend).
3. Mapa con geolocalización del navegador + Leaflet + tiles OSM.
4. Endpoints proxy (`/api/geocode`, `/api/route`, `/api/pois`) + pantalla "Nueva ruta" completa, guardando en `routes`.
5. Alertas: crear + tiempo real con Supabase Realtime.
6. Reseñas: ver/crear, tanto para POIs de OSM como para lugares agregados a mano.
7. Pulido: manejo de errores visible (no silencioso) cuando Nominatim/OSRM/Overpass fallan, loading states, responsive básico.
8. `git init` + commit inicial (al final, cuando ya funcione, no antes).

Andá fase por fase, probando cada una (levantando el contenedor con `docker compose up`) antes de pasar a la siguiente. No asumas que algo funciona sin probarlo en el navegador.
