let mapaPreview = null;
let capaPreview = null;

function formatearFecha(iso) {
  return new Date(iso).toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function crearTarjetaRuta(ruta) {
  const card = document.createElement("div");
  card.className = "tarjeta-ruta";

  const titulo = document.createElement("h3");
  titulo.textContent = ruta.nombre;

  const info = document.createElement("p");
  info.className = "tarjeta-ruta-info";
  const distancia = ruta.distancia_km ? `${ruta.distancia_km} km · ` : "";
  info.textContent = `${distancia}${formatearFecha(ruta.created_at)}`;

  const acciones = document.createElement("div");
  acciones.className = "tarjeta-ruta-acciones";

  const btnVer = document.createElement("button");
  btnVer.type = "button";
  btnVer.className = "btn-ver-ruta";
  btnVer.textContent = "Ver ruta";
  btnVer.addEventListener("click", () => verRuta(ruta));

  const btnEliminar = document.createElement("button");
  btnEliminar.type = "button";
  btnEliminar.className = "btn-eliminar-ruta";
  btnEliminar.textContent = "Eliminar";
  btnEliminar.addEventListener("click", () => eliminarRuta(ruta.id, card));

  acciones.appendChild(btnVer);
  acciones.appendChild(btnEliminar);
  card.appendChild(titulo);
  card.appendChild(info);
  card.appendChild(acciones);
  return card;
}

async function cargarRutas() {
  const sesion = await requerirAutenticacion("/login");
  if (!sesion) return;

  const { data: rutas, error } = await supabaseClient
    .from("routes")
    .select("*")
    .eq("user_id", sesion.user.id)
    .order("created_at", { ascending: false });

  if (error) {
    mostrarToast("No se pudieron cargar tus rutas.", "error");
    return;
  }

  if (!rutas || rutas.length === 0) {
    document.getElementById("sin-rutas").hidden = false;
    return;
  }

  const lista = document.getElementById("lista-rutas");
  rutas.forEach((ruta) => lista.appendChild(crearTarjetaRuta(ruta)));
}

function verRuta(ruta) {
  const dialogo = document.getElementById("dialog-ruta");
  document.getElementById("dialog-ruta-titulo").textContent = ruta.nombre;
  dialogo.showModal();

  requestAnimationFrame(() => {
    if (!mapaPreview) {
      mapaPreview = L.map("mapa-preview");
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(mapaPreview);
    }
    if (capaPreview) {
      mapaPreview.removeLayer(capaPreview);
    }

    const waypoints = ruta.waypoints;
    mapaPreview.invalidateSize();

    if (Array.isArray(waypoints) && waypoints.length > 0) {
      capaPreview = L.layerGroup().addTo(mapaPreview);
      const linea = L.polyline(waypoints, { color: "#4db8ff", weight: 4 }).addTo(capaPreview);
      L.marker(waypoints[0]).addTo(capaPreview).bindPopup(`Origen: ${ruta.origen}`);
      L.marker(waypoints[waypoints.length - 1]).addTo(capaPreview).bindPopup(`Destino: ${ruta.destino}`);
      mapaPreview.fitBounds(linea.getBounds(), { padding: [20, 20] });
    } else {
      mapaPreview.setView([-33.6832, -71.2235], 5);
    }
  });
}

async function eliminarRuta(id, card) {
  if (!confirm("¿Eliminar esta ruta?")) return;

  const { error } = await supabaseClient.from("routes").delete().eq("id", id);
  if (error) {
    mostrarToast(error.message, "error");
    return;
  }
  card.remove();
  mostrarToast("Ruta eliminada.", "success");

  if (document.getElementById("lista-rutas").children.length === 0) {
    document.getElementById("sin-rutas").hidden = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  cargarRutas();
  document.getElementById("btn-cerrar-ruta").addEventListener("click", () => {
    document.getElementById("dialog-ruta").close();
  });
});
