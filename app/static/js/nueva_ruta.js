const EMOJI_POI = {
  gasolinera: "⛽",
  hotel: "🏨",
  mecanico: "🔧",
  hospital: "🏥",
  restaurante: "🍽️",
  otro: "📍",
};

let mapaRuta;
let capaRuta = null;
let capaPois = [];
let ultimaRutaCalculada = null;
let sesionActual = null;

function iconoPoi(tipo) {
  return L.divIcon({
    html: `<div class="marcador-poi">${EMOJI_POI[tipo] || EMOJI_POI.otro}</div>`,
    className: "",
    iconSize: [28, 28],
  });
}

function limpiarMapa() {
  if (capaRuta) {
    mapaRuta.removeLayer(capaRuta);
    capaRuta = null;
  }
  capaPois.forEach((capa) => mapaRuta.removeLayer(capa));
  capaPois = [];
}

async function obtenerJson(url) {
  const resp = await fetch(url);
  if (!resp.ok) {
    let detalle = `Error ${resp.status}`;
    try {
      const cuerpo = await resp.json();
      if (cuerpo.detail) detalle = cuerpo.detail;
    } catch (_) {
      // el cuerpo no era JSON, se usa el mensaje genérico
    }
    throw new Error(detalle);
  }
  return resp.json();
}

async function agregarPoisDeRuta(waypoints) {
  try {
    const puntos = waypoints.map(([lat, lng]) => `${lat},${lng}`).join(";");
    const pois = await obtenerJson(`/api/pois_ruta?puntos=${encodeURIComponent(puntos)}&radius=3000`);
    pois.forEach((poi) => {
      const marcador = L.marker([poi.latitude, poi.longitude], { icon: iconoPoi(poi.tipo) })
        .addTo(mapaRuta)
        .bindPopup(`<b>${poi.nombre}</b><br>${poi.tipo}`);
      capaPois.push(marcador);
    });
  } catch (error) {
    mostrarToast("No se pudieron cargar los puntos de interés cercanos.", "info");
  }
}

async function buscarRuta(e) {
  e.preventDefault();
  const origenTexto = document.getElementById("origen").value.trim();
  const destinoTexto = document.getElementById("destino").value.trim();
  const btnBuscar = document.getElementById("btn-buscar");
  const btnGuardar = document.getElementById("btn-guardar");
  const resumen = document.getElementById("resumen-ruta");

  btnBuscar.disabled = true;
  btnBuscar.textContent = "Buscando...";
  btnGuardar.hidden = true;
  document.getElementById("panel-clima").hidden = true;
  resumen.textContent = "";
  limpiarMapa();

  try {
    const origen = await obtenerJson(`/api/geocode?q=${encodeURIComponent(origenTexto)}`);
    const destino = await obtenerJson(`/api/geocode?q=${encodeURIComponent(destinoTexto)}`);

    const ruta = await obtenerJson(
      `/api/route?origin_lat=${origen.latitude}&origin_lng=${origen.longitude}` +
        `&dest_lat=${destino.latitude}&dest_lng=${destino.longitude}`
    );

    capaRuta = L.polyline(ruta.coordinates, { color: "#4db8ff", weight: 4 }).addTo(mapaRuta);
    L.marker([origen.latitude, origen.longitude]).addTo(mapaRuta).bindPopup(`Origen: ${origenTexto}`);
    L.marker([destino.latitude, destino.longitude]).addTo(mapaRuta).bindPopup(`Destino: ${destinoTexto}`);
    mapaRuta.fitBounds(capaRuta.getBounds(), { padding: [30, 30] });

    resumen.textContent = `Distancia: ${ruta.distancia_km} km`;

    await agregarPoisDeRuta(ruta.coordinates);

    ultimaRutaCalculada = {
      origenTexto,
      destinoTexto,
      origen,
      destino,
      waypoints: ruta.coordinates,
      distanciaKm: ruta.distancia_km,
    };
    btnGuardar.hidden = false;
    mostrarPanelClima();
    await verClimaRuta();
  } catch (error) {
    mostrarToast(error.message || "No se pudo calcular la ruta.", "error");
  } finally {
    btnBuscar.disabled = false;
    btnBuscar.textContent = "Buscar ruta";
  }
}

function mostrarPanelClima() {
  const panel = document.getElementById("panel-clima");
  const inputFecha = document.getElementById("fecha-viaje");
  document.getElementById("resultado-clima").innerHTML = "";

  const hoy = new Date();
  const maxFecha = new Date(hoy);
  maxFecha.setDate(maxFecha.getDate() + 4);
  const aIso = (d) => d.toISOString().split("T")[0];
  inputFecha.min = aIso(hoy);
  inputFecha.max = aIso(maxFecha);
  if (!inputFecha.value) inputFecha.value = aIso(hoy);

  panel.hidden = false;
}

function puntosClimaDeRuta() {
  const { origenTexto, destinoTexto, origen, destino, waypoints } = ultimaRutaCalculada;
  const medio = waypoints[Math.floor(waypoints.length / 2)];
  return [
    { etiqueta: origenTexto, lat: origen.latitude, lng: origen.longitude },
    { etiqueta: "A mitad de camino", lat: medio[0], lng: medio[1] },
    { etiqueta: destinoTexto, lat: destino.latitude, lng: destino.longitude },
  ];
}

const VELOCIDAD_PRUDENTE_KMH = 80;
const INTERVALO_DESCANSO_HORAS = 2;
const DURACION_PARADA_MIN = 20;

function formatHoras(horas) {
  const totalMin = Math.round(horas * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

function calcularTiempoViaje(distanciaKm) {
  const horasConduccion = distanciaKm / VELOCIDAD_PRUDENTE_KMH;
  const paradas = Math.floor(horasConduccion / INTERVALO_DESCANSO_HORAS);
  const horasTotal = horasConduccion + (paradas * DURACION_PARADA_MIN) / 60;
  return { horasConduccion, paradas, horasTotal };
}

function tarjetaTiempoViajeHtml(distanciaKm) {
  const { horasConduccion, paradas, horasTotal } = calcularTiempoViaje(distanciaKm);
  const textoParadas =
    paradas > 0
      ? `${paradas} parada${paradas === 1 ? "" : "s"} de ~${DURACION_PARADA_MIN} min (cada ${INTERVALO_DESCANSO_HORAS} h de manejo)`
      : "Sin paradas necesarias";
  return `
    <div class="tarjeta-clima tarjeta-tiempo">
      <div class="punto-clima">Tiempo estimado</div>
      <div class="emoji-clima">🏍️</div>
      <div>${formatHoras(horasConduccion)} de manejo</div>
      <div class="temp-clima">${textoParadas}</div>
      <div class="temp-clima">Total con paradas: ${formatHoras(horasTotal)}</div>
    </div>`;
}

function tarjetaClimaCargando(etiqueta) {
  return `<div class="tarjeta-clima"><div class="punto-clima">${etiqueta}</div>Cargando...</div>`;
}

function tarjetaClimaHtml(etiqueta, clima) {
  if (!clima) {
    return `<div class="tarjeta-clima"><div class="punto-clima">${etiqueta}</div>Sin datos disponibles</div>`;
  }
  return `
    <div class="tarjeta-clima">
      <div class="punto-clima">${etiqueta}</div>
      <div class="emoji-clima">${clima.emoji}</div>
      <div>${clima.descripcion}</div>
      <div class="temp-clima">${clima.temp_min}° / ${clima.temp_max}°C</div>
      <div class="temp-clima">💧 ${clima.precipitacion_mm} mm</div>
    </div>`;
}

async function verClimaRuta() {
  if (!ultimaRutaCalculada) return;
  const fecha = document.getElementById("fecha-viaje").value;
  if (!fecha) {
    mostrarToast("Elegí una fecha de viaje.", "info");
    return;
  }

  const btn = document.getElementById("btn-ver-clima");
  const contenedor = document.getElementById("resultado-clima");
  const puntos = puntosClimaDeRuta();

  const tarjetaTiempo = tarjetaTiempoViajeHtml(ultimaRutaCalculada.distanciaKm);

  btn.disabled = true;
  btn.textContent = "Consultando...";
  contenedor.innerHTML = tarjetaTiempo + puntos.map((p) => tarjetaClimaCargando(p.etiqueta)).join("");

  const resultados = [];
  // Secuencial, no en paralelo, para no saturar el servicio gratuito.
  for (const punto of puntos) {
    try {
      const clima = await obtenerJson(`/api/clima?lat=${punto.lat}&lng=${punto.lng}&fecha=${fecha}`);
      resultados.push({ etiqueta: punto.etiqueta, clima });
    } catch (error) {
      resultados.push({ etiqueta: punto.etiqueta, clima: null });
    }
  }

  contenedor.innerHTML = tarjetaTiempo + resultados.map((r) => tarjetaClimaHtml(r.etiqueta, r.clima)).join("");
  btn.disabled = false;
  btn.textContent = "Ver clima en la ruta";

  if (resultados.every((r) => !r.clima)) {
    mostrarToast("No se pudo obtener el clima para esa fecha.", "error");
  }
}

async function iniciarRuta() {
  if (!ultimaRutaCalculada || !sesionActual) return;
  const btnIniciar = document.getElementById("btn-guardar");
  btnIniciar.disabled = true;
  btnIniciar.textContent = "Iniciando...";

  const { origenTexto, destinoTexto, origen, destino, waypoints, distanciaKm } = ultimaRutaCalculada;

  const { error } = await supabaseClient.from("routes").insert({
    user_id: sesionActual.user.id,
    nombre: `${origenTexto} → ${destinoTexto}`,
    origen: origenTexto,
    destino: destinoTexto,
    origen_geom: `POINT(${origen.longitude} ${origen.latitude})`,
    destino_geom: `POINT(${destino.longitude} ${destino.latitude})`,
    waypoints,
    distancia_km: distanciaKm,
  });

  if (error) {
    mostrarToast(error.message, "error");
    btnIniciar.disabled = false;
    btnIniciar.textContent = "🏁 Iniciar ruta";
    return;
  }

  mostrarToast("¡Ruta iniciada! Ya la tenés disponible en Mis rutas.", "success");
  window.location.href = "/";
}

async function iniciarPantallaNuevaRuta() {
  try {
    if (typeof supabaseClient === "undefined" || !supabaseClient) {
      throw new Error("No se pudo conectar con el servicio (Supabase no cargó).");
    }
    if (typeof L === "undefined") {
      throw new Error("No se pudo cargar el mapa (Leaflet no cargó).");
    }

    sesionActual = await requerirAutenticacion("/login");
    if (!sesionActual) return;

    mapaRuta = L.map("mapa-ruta").setView([-33.6832, -71.2235], 6);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(mapaRuta);

    document.getElementById("form-ruta").addEventListener("submit", buscarRuta);
    document.getElementById("btn-guardar").addEventListener("click", iniciarRuta);
    document.getElementById("btn-ver-clima").addEventListener("click", verClimaRuta);
    document.getElementById("fecha-viaje").addEventListener("change", verClimaRuta);
  } catch (error) {
    console.error(error);
    mostrarToast("No se pudo cargar la página (posible problema de red). Recargá para reintentar.", "error");
    return;
  }
}

document.addEventListener("DOMContentLoaded", iniciarPantallaNuevaRuta);
