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

async function agregarPois(lat, lng) {
  try {
    const pois = await obtenerJson(`/api/pois?lat=${lat}&lng=${lng}&radius=5000`);
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

    // Secuencial (no en paralelo) para no saturar Overpass.
    await agregarPois(origen.latitude, origen.longitude);
    await agregarPois(destino.latitude, destino.longitude);

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
  maxFecha.setDate(maxFecha.getDate() + 15);
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

  btn.disabled = true;
  btn.textContent = "Consultando...";
  contenedor.innerHTML = puntos.map((p) => tarjetaClimaCargando(p.etiqueta)).join("");

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

  contenedor.innerHTML = resultados.map((r) => tarjetaClimaHtml(r.etiqueta, r.clima)).join("");
  btn.disabled = false;
  btn.textContent = "Ver clima en la ruta";

  if (resultados.every((r) => !r.clima)) {
    mostrarToast("No se pudo obtener el clima para esa fecha.", "error");
  }
}

async function guardarRuta() {
  if (!ultimaRutaCalculada || !sesionActual) return;
  const btnGuardar = document.getElementById("btn-guardar");
  btnGuardar.disabled = true;
  btnGuardar.textContent = "Guardando...";

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
    btnGuardar.disabled = false;
    btnGuardar.textContent = "Guardar ruta";
    return;
  }

  mostrarToast("Ruta guardada.", "success");
  window.location.href = "/";
}

async function iniciarPantallaNuevaRuta() {
  sesionActual = await requerirAutenticacion("/login");
  if (!sesionActual) return;

  mapaRuta = L.map("mapa-ruta").setView([-33.6832, -71.2235], 6);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(mapaRuta);

  document.getElementById("form-ruta").addEventListener("submit", buscarRuta);
  document.getElementById("btn-guardar").addEventListener("click", guardarRuta);
  document.getElementById("btn-ver-clima").addEventListener("click", verClimaRuta);
}

document.addEventListener("DOMContentLoaded", iniciarPantallaNuevaRuta);
