const UBICACION_FALLBACK = [-33.6832, -71.2235]; // Melipilla, Chile

const EMOJI_ALERTA = {
  accidente: "🚧",
  ayuda: "🆘",
  peligro: "⚠️",
  control_policial: "👮",
  clima: "🌧️",
};

const EMOJI_POI = {
  gasolinera: "⛽",
  hotel: "🏨",
  mecanico: "🔧",
  hospital: "🏥",
  restaurante: "🍽️",
  otro: "📍",
};

let mapa;
let marcadorUsuario;
let ubicacionActual = UBICACION_FALLBACK;
let ubicacionEsReal = false;
let ultimoPuntoPoisCargado = null;
let cargandoPoisLive = false;
const poisIdsCargados = new Set();
const marcadoresAlertas = new Map();

const RADIO_CARGA_POIS_M = 5000;
const DISTANCIA_RECARGA_POIS_M = 2000;

function inicializarMapa(centro) {
  mapa = L.map("mapa").setView(centro, 13);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(mapa);
  marcadorUsuario = L.marker(centro).addTo(mapa).bindPopup("Vos estás acá");
}

function iniciarSeguimientoUbicacion() {
  if (!navigator.geolocation) {
    mostrarToast("Este navegador no soporta geolocalización, usando ubicación por defecto.", "info");
    return;
  }

  let primeraFix = true;

  navigator.geolocation.watchPosition(
    (pos) => {
      const punto = [pos.coords.latitude, pos.coords.longitude];
      ubicacionActual = punto;
      ubicacionEsReal = true;
      marcadorUsuario.setLatLng(punto);
      if (primeraFix) {
        mapa.setView(punto, 14);
        primeraFix = false;
        cargarPoisSiTeMoviste(punto[0], punto[1]);
      } else {
        cargarPoisSiTeMoviste(punto[0], punto[1]);
      }
    },
    () => {
      mostrarToast("No se pudo obtener tu ubicación, usando ubicación por defecto.", "info");
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
  );
}

function obtenerUbicacionFresca() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ punto: ubicacionActual, esReal: ubicacionEsReal });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ punto: [pos.coords.latitude, pos.coords.longitude], esReal: true }),
      () => resolve({ punto: ubicacionActual, esReal: ubicacionEsReal }),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 8000 }
    );
  });
}

async function dibujarRutaGuardada(userId) {
  const { data: rutas, error } = await supabaseClient
    .from("routes")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error || !rutas || rutas.length === 0) return;

  const ruta = rutas[0];
  const waypoints = ruta.waypoints;
  if (!Array.isArray(waypoints) || waypoints.length === 0) return;

  const linea = L.polyline(waypoints, { color: "#4db8ff", weight: 4 }).addTo(mapa);
  L.marker(waypoints[0]).addTo(mapa).bindPopup(`Origen: ${ruta.origen}`);
  L.marker(waypoints[waypoints.length - 1]).addTo(mapa).bindPopup(`Destino: ${ruta.destino}`);
  mapa.fitBounds(linea.getBounds(), { padding: [40, 40] });

  try {
    const puntos = waypoints.map(([lat, lng]) => `${lat},${lng}`).join(";");
    const resp = await fetch(`/api/pois_ruta?puntos=${encodeURIComponent(puntos)}&radius=3000`);
    if (resp.ok) renderizarPois(await resp.json());
  } catch (error) {
    mostrarToast("No se pudieron cargar los puntos de interés de la ruta guardada.", "info");
  }
}

function iconoPoi(tipo) {
  return L.divIcon({
    html: `<div class="marcador-poi">${EMOJI_POI[tipo] || EMOJI_POI.otro}</div>`,
    className: "",
    iconSize: [28, 28],
  });
}

function renderizarPois(pois) {
  pois.forEach((poi) => {
    if (poisIdsCargados.has(poi.id)) return;
    poisIdsCargados.add(poi.id);
    L.marker([poi.latitude, poi.longitude], { icon: iconoPoi(poi.tipo) })
      .addTo(mapa)
      .bindPopup(`<b>${poi.nombre}</b><br>${poi.tipo}<br><a href="#" class="ver-resenas">Ver reseñas</a>`)
      .on("popupopen", (e) => {
        e.popup
          .getElement()
          .querySelector(".ver-resenas")
          .addEventListener("click", async (ev) => {
            ev.preventDefault();
            const poiId = await obtenerOCrearPoi(poi);
            if (poiId) abrirPanelResena(poiId, poi.nombre);
          });
      });
  });
}

async function cargarPoisCercanos(lat, lng) {
  try {
    const resp = await fetch(`/api/pois?lat=${lat}&lng=${lng}&radius=${RADIO_CARGA_POIS_M}`);
    if (!resp.ok) return;
    renderizarPois(await resp.json());
  } catch (error) {
    mostrarToast("No se pudieron cargar los puntos de interés cercanos.", "info");
  }
}

function cargarPoisSiTeMoviste(lat, lng) {
  if (cargandoPoisLive) return;
  if (
    ultimoPuntoPoisCargado &&
    distanciaMetros(lat, lng, ultimoPuntoPoisCargado[0], ultimoPuntoPoisCargado[1]) < DISTANCIA_RECARGA_POIS_M
  ) {
    return;
  }
  ultimoPuntoPoisCargado = [lat, lng];
  cargandoPoisLive = true;
  cargarPoisCercanos(lat, lng).finally(() => {
    cargandoPoisLive = false;
  });
}

async function obtenerOCrearPoi(poiOsm) {
  const { data: existente } = await supabaseClient
    .from("pois")
    .select("id")
    .eq("osm_id", poiOsm.id)
    .maybeSingle();
  if (existente) return existente.id;

  const { data: { user } } = await supabaseClient.auth.getUser();
  const { data: creado, error } = await supabaseClient
    .from("pois")
    .insert({
      tipo: poiOsm.tipo,
      nombre: poiOsm.nombre,
      ubicacion: `POINT(${poiOsm.longitude} ${poiOsm.latitude})`,
      fuente: "osm",
      agregado_por: user.id,
      osm_id: poiOsm.id,
    })
    .select("id")
    .single();

  if (error) {
    const { data: reintento } = await supabaseClient
      .from("pois")
      .select("id")
      .eq("osm_id", poiOsm.id)
      .maybeSingle();
    if (reintento) return reintento.id;
    mostrarToast("No se pudo abrir las reseñas de este lugar.", "error");
    return null;
  }
  return creado.id;
}

async function cargarPoisUsuario() {
  const { data: pois, error } = await supabaseClient
    .from("pois")
    .select("*")
    .eq("fuente", "usuario");

  if (error || !pois) return;

  pois.forEach((poi) => {
    const punto = parseWkbPoint(poi.ubicacion);
    if (!punto) return;
    agregarMarcadorLugar(poi.id, poi.tipo, poi.nombre, [punto.lat, punto.lng]);
  });
}

function agregarMarcadorLugar(poiId, tipo, nombre, latlng) {
  L.marker(latlng, { icon: iconoPoi(tipo) })
    .addTo(mapa)
    .bindPopup(`<b>${nombre}</b><br>${tipo}<br><a href="#" class="ver-resenas">Ver reseñas</a>`)
    .on("popupopen", (e) => {
      e.popup
        .getElement()
        .querySelector(".ver-resenas")
        .addEventListener("click", (ev) => {
          ev.preventDefault();
          abrirPanelResena(poiId, nombre);
        });
    });
}

function calcularPromedio(resenas) {
  if (!resenas.length) return null;
  const suma = resenas.reduce((acc, r) => acc + r.calificacion, 0);
  return (suma / resenas.length).toFixed(1);
}

async function cargarResenas(poiId) {
  const { data, error } = await supabaseClient
    .from("resenas")
    .select("*, profiles(username)")
    .eq("poi_id", poiId)
    .order("created_at", { ascending: false });
  return error ? [] : data;
}

async function abrirPanelResena(poiId, nombre) {
  const dialogo = document.getElementById("dialog-resena");
  dialogo.dataset.poiId = poiId;
  document.getElementById("resena-titulo").textContent = nombre;
  document.getElementById("resena-promedio").textContent = "Cargando...";
  document.getElementById("resena-lista").innerHTML = "";
  dialogo.showModal();

  const resenas = await cargarResenas(poiId);
  const promedio = calcularPromedio(resenas);
  document.getElementById("resena-promedio").textContent = promedio
    ? `⭐ ${promedio} (${resenas.length} reseña${resenas.length === 1 ? "" : "s"})`
    : "Sin reseñas todavía.";

  const lista = document.getElementById("resena-lista");
  lista.innerHTML = "";
  resenas.forEach((r) => {
    const li = document.createElement("li");
    const autor = r.profiles ? r.profiles.username : "Usuario";
    li.textContent = `${"⭐".repeat(r.calificacion)} — ${autor}${r.comentario ? ": " + r.comentario : ""}`;
    lista.appendChild(li);
  });
}

function configurarModalResena() {
  const dialogo = document.getElementById("dialog-resena");
  document.getElementById("btn-cerrar-resena").addEventListener("click", () => dialogo.close());
  document.getElementById("form-resena").addEventListener("submit", async (e) => {
    e.preventDefault();
    const poiId = dialogo.dataset.poiId;
    const calificacion = parseInt(document.getElementById("calificacion-resena").value, 10);
    const comentario = document.getElementById("comentario-resena").value.trim();
    const btn = document.getElementById("btn-confirmar-resena");
    btn.disabled = true;

    const { data: { user } } = await supabaseClient.auth.getUser();
    const { error } = await supabaseClient.from("resenas").insert({
      poi_id: poiId,
      user_id: user.id,
      calificacion,
      comentario: comentario || null,
    });

    btn.disabled = false;
    if (error) {
      mostrarToast(error.message, "error");
      return;
    }
    document.getElementById("comentario-resena").value = "";
    mostrarToast("Reseña guardada.", "success");
    await abrirPanelResena(poiId, document.getElementById("resena-titulo").textContent);
  });
}

function configurarModalLugar() {
  const dialogo = document.getElementById("dialog-lugar");
  document.getElementById("btn-abrir-lugar").addEventListener("click", () => dialogo.showModal());
  document.getElementById("btn-cancelar-lugar").addEventListener("click", () => dialogo.close());
  document.getElementById("form-lugar").addEventListener("submit", async (e) => {
    e.preventDefault();
    const tipo = document.getElementById("tipo-lugar").value;
    const nombre = document.getElementById("nombre-lugar").value.trim();
    const btn = document.getElementById("btn-confirmar-lugar");
    btn.disabled = true;
    btn.textContent = "Ubicando...";

    const { punto, esReal } = await obtenerUbicacionFresca();
    if (!esReal) {
      mostrarToast("No se pudo confirmar tu ubicación real, se usó la última conocida.", "info");
    }
    btn.textContent = "Agregar";

    const { data: { user } } = await supabaseClient.auth.getUser();
    const { data: creado, error } = await supabaseClient
      .from("pois")
      .insert({
        tipo,
        nombre,
        ubicacion: `POINT(${punto[1]} ${punto[0]})`,
        fuente: "usuario",
        agregado_por: user.id,
      })
      .select("id")
      .single();

    btn.disabled = false;
    if (error) {
      mostrarToast(error.message, "error");
      return;
    }
    agregarMarcadorLugar(creado.id, tipo, nombre, punto);
    document.getElementById("nombre-lugar").value = "";
    dialogo.close();
    mostrarToast("Lugar agregado.", "success");
  });
}

function iconoAlerta(tipo) {
  return L.divIcon({
    html: `<div class="marcador-poi">${EMOJI_ALERTA[tipo] || "❗"}</div>`,
    className: "",
    iconSize: [28, 28],
  });
}

function alertaVigente(alerta) {
  if (!alerta.activa) return false;
  if (alerta.expira_at && new Date(alerta.expira_at) <= new Date()) return false;
  return true;
}

function pintarAlerta(alerta) {
  quitarAlerta(alerta.id);
  if (!alertaVigente(alerta)) return;

  const punto = parseWkbPoint(alerta.ubicacion);
  if (!punto) return;

  const marcador = L.marker([punto.lat, punto.lng], { icon: iconoAlerta(alerta.tipo) })
    .addTo(mapa)
    .bindPopup(
      `<b>${EMOJI_ALERTA[alerta.tipo] || ""} ${alerta.tipo.replace("_", " ")}</b>` +
        (alerta.descripcion ? `<br>${alerta.descripcion}` : "")
    );
  marcadoresAlertas.set(alerta.id, marcador);
}

function quitarAlerta(id) {
  const marcador = marcadoresAlertas.get(id);
  if (marcador) {
    mapa.removeLayer(marcador);
    marcadoresAlertas.delete(id);
  }
}

async function cargarAlertasActivas() {
  const { data: alertas, error } = await supabaseClient
    .from("alerts")
    .select("*")
    .eq("activa", true);

  if (error || !alertas) return;
  alertas.forEach(pintarAlerta);
}

function suscribirseAlertasRealtime() {
  supabaseClient
    .channel("alertas-realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "alerts" },
      (payload) => {
        if (payload.eventType === "DELETE") {
          quitarAlerta(payload.old.id);
        } else {
          pintarAlerta(payload.new);
        }
      }
    )
    .subscribe();
}

function configurarModalAlerta() {
  const dialogo = document.getElementById("dialog-alerta");
  document.getElementById("btn-abrir-alerta").addEventListener("click", () => {
    dialogo.showModal();
  });
  document.getElementById("btn-cancelar-alerta").addEventListener("click", () => {
    dialogo.close();
  });
  document.getElementById("form-alerta").addEventListener("submit", async (e) => {
    e.preventDefault();
    const tipo = document.getElementById("tipo-alerta").value;
    const descripcion = document.getElementById("descripcion-alerta").value.trim();
    const btn = document.getElementById("btn-confirmar-alerta");
    btn.disabled = true;
    btn.textContent = "Ubicando...";

    const { punto, esReal } = await obtenerUbicacionFresca();
    if (!esReal) {
      mostrarToast("No se pudo confirmar tu ubicación real, se usó la última conocida.", "info");
    }
    btn.textContent = "Reportar";

    const { data: { user } } = await supabaseClient.auth.getUser();
    const { error } = await supabaseClient.from("alerts").insert({
      user_id: user.id,
      tipo,
      descripcion: descripcion || null,
      ubicacion: `POINT(${punto[1]} ${punto[0]})`,
    });

    btn.disabled = false;
    if (error) {
      mostrarToast(error.message, "error");
      return;
    }
    document.getElementById("descripcion-alerta").value = "";
    dialogo.close();
    mostrarToast("Alerta reportada.", "success");
  });
}

function mostrarErrorCargaMapa(mensaje) {
  const overlay = document.getElementById("overlay-carga");
  const texto = document.getElementById("overlay-carga-texto");
  const btnReintentar = document.getElementById("btn-reintentar-carga");
  if (!overlay) return;
  overlay.hidden = false;
  if (texto) texto.textContent = mensaje;
  if (btnReintentar) {
    btnReintentar.hidden = false;
    btnReintentar.onclick = () => window.location.reload();
  }
}

async function iniciarPantallaMapa() {
  const overlay = document.getElementById("overlay-carga");
  try {
    if (typeof supabaseClient === "undefined" || !supabaseClient) {
      throw new Error("No se pudo conectar con el servicio (Supabase no cargó).");
    }
    if (typeof L === "undefined") {
      throw new Error("No se pudo cargar el mapa (Leaflet no cargó).");
    }

    const sesion = await requerirAutenticacion("/login");
    if (!sesion) return;

    inicializarMapa(UBICACION_FALLBACK);
    iniciarSeguimientoUbicacion();
    configurarModalAlerta();
    configurarModalLugar();
    configurarModalResena();

    await dibujarRutaGuardada(sesion.user.id);
    await cargarPoisUsuario();
    await cargarAlertasActivas();
    suscribirseAlertasRealtime();
    if (overlay) overlay.hidden = true;
  } catch (error) {
    console.error(error);
    mostrarErrorCargaMapa(
      "No se pudo cargar la app (posible problema de red). Tocá reintentar."
    );
  }
}

document.addEventListener("DOMContentLoaded", iniciarPantallaMapa);
