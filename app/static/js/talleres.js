let sesionActual = null;
let talleresCache = new Map();

function calcularPromedio(resenas) {
  if (!resenas.length) return null;
  const suma = resenas.reduce((acc, r) => acc + r.calificacion, 0);
  return (suma / resenas.length).toFixed(1);
}

async function cargarTalleres() {
  const { data: pois, error } = await supabaseClient
    .from("pois")
    .select("*")
    .eq("tipo", "mecanico");

  if (error) {
    mostrarToast("No se pudieron cargar los talleres.", "error");
    return;
  }

  if (!pois || pois.length === 0) {
    document.getElementById("sin-talleres").hidden = false;
    return;
  }
  document.getElementById("sin-talleres").hidden = true;

  const ids = pois.map((p) => p.id);
  const { data: resenas } = await supabaseClient
    .from("resenas")
    .select("poi_id, calificacion")
    .in("poi_id", ids);

  const resenasPorPoi = new Map();
  (resenas || []).forEach((r) => {
    if (!resenasPorPoi.has(r.poi_id)) resenasPorPoi.set(r.poi_id, []);
    resenasPorPoi.get(r.poi_id).push(r);
  });

  const grilla = document.getElementById("grilla-talleres");
  grilla.innerHTML = "";
  talleresCache.clear();

  pois.forEach((poi) => {
    talleresCache.set(poi.id, poi);
    const resenasPoi = resenasPorPoi.get(poi.id) || [];
    const promedio = calcularPromedio(resenasPoi);

    const card = document.createElement("div");
    card.className = "tarjeta-taller";
    card.innerHTML = `
      <h3>${escaparHtml(poi.nombre)}</h3>
      <div class="taller-promedio">${promedio ? `⭐ ${promedio} (${resenasPoi.length})` : "Sin reseñas todavía"}</div>
      <div class="taller-fuente">${poi.fuente === "usuario" ? "Agregado por la comunidad" : "OpenStreetMap"}</div>
      <button type="button">Ver / dejar reseña</button>
    `;
    card.querySelector("button").addEventListener("click", () => abrirPanelResena(poi.id, poi.nombre));
    grilla.appendChild(card);
  });
}

async function cargarResenasTaller(poiId) {
  const { data, error } = await supabaseClient
    .from("resenas")
    .select("*, profiles(username)")
    .eq("poi_id", poiId)
    .order("created_at", { ascending: false });
  return error ? [] : data;
}

async function abrirPanelResena(poiId, nombre) {
  const dialogo = document.getElementById("dialog-resena-taller");
  dialogo.dataset.poiId = poiId;
  document.getElementById("resena-taller-titulo").textContent = nombre;
  document.getElementById("resena-taller-promedio").textContent = "Cargando...";
  document.getElementById("resena-taller-lista").innerHTML = "";
  dialogo.showModal();

  const resenas = await cargarResenasTaller(poiId);
  const promedio = calcularPromedio(resenas);
  document.getElementById("resena-taller-promedio").textContent = promedio
    ? `⭐ ${promedio} (${resenas.length} reseña${resenas.length === 1 ? "" : "s"})`
    : "Sin reseñas todavía.";

  const lista = document.getElementById("resena-taller-lista");
  lista.innerHTML = "";
  resenas.forEach((r) => {
    const li = document.createElement("li");
    const autor = r.profiles ? r.profiles.username : "Usuario";
    li.textContent = `${"⭐".repeat(r.calificacion)} — ${autor}${r.comentario ? ": " + r.comentario : ""}`;
    lista.appendChild(li);
  });
}

function configurarModalResenaTaller() {
  const dialogo = document.getElementById("dialog-resena-taller");
  document.getElementById("btn-cerrar-resena-taller").addEventListener("click", () => dialogo.close());
  document.getElementById("form-resena-taller").addEventListener("submit", async (e) => {
    e.preventDefault();
    const sesion = await requerirCuentaParaAccion("Creá una cuenta gratis para dejar una reseña.");
    if (!sesion) return;
    sesionActual = sesion;

    const poiId = dialogo.dataset.poiId;
    const calificacion = parseInt(document.getElementById("calificacion-resena-taller").value, 10);
    const comentario = document.getElementById("comentario-resena-taller").value.trim();
    const btn = document.getElementById("btn-confirmar-resena-taller");
    btn.disabled = true;

    const { error } = await supabaseClient.from("resenas").insert({
      poi_id: poiId,
      user_id: sesionActual.user.id,
      calificacion,
      comentario: comentario || null,
    });

    btn.disabled = false;
    if (error) {
      mostrarToast(error.message, "error");
      return;
    }
    document.getElementById("comentario-resena-taller").value = "";
    mostrarToast("Reseña guardada.", "success");
    await abrirPanelResena(poiId, document.getElementById("resena-taller-titulo").textContent);
    await cargarTalleres();
  });
}

function configurarModalTaller() {
  const dialogo = document.getElementById("dialog-taller");
  document.getElementById("btn-abrir-taller").addEventListener("click", async () => {
    const sesion = await requerirCuentaParaAccion("Creá una cuenta gratis para agregar un taller.");
    if (!sesion) return;
    sesionActual = sesion;
    dialogo.showModal();
  });
  document.getElementById("btn-cancelar-taller").addEventListener("click", () => dialogo.close());

  document.getElementById("form-taller").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nombre = document.getElementById("nombre-taller").value.trim();
    const direccion = document.getElementById("direccion-taller").value.trim();
    const btn = document.getElementById("btn-confirmar-taller");
    btn.disabled = true;
    btn.textContent = "Ubicando...";

    try {
      const resp = await fetch(`/api/geocode?q=${encodeURIComponent(direccion)}`);
      if (!resp.ok) throw new Error("No se pudo encontrar esa dirección.");
      const lugar = await resp.json();

      const { error } = await supabaseClient.from("pois").insert({
        tipo: "mecanico",
        nombre,
        ubicacion: `POINT(${lugar.longitude} ${lugar.latitude})`,
        fuente: "usuario",
        agregado_por: sesionActual.user.id,
      });

      if (error) throw new Error(error.message);

      document.getElementById("form-taller").reset();
      dialogo.close();
      mostrarToast("Taller agregado.", "success");
      await cargarTalleres();
    } catch (error) {
      mostrarToast(error.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Agregar";
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    sesionActual = await obtenerSesion();
    configurarModalTaller();
    configurarModalResenaTaller();
    await cargarTalleres();
  } catch (error) {
    console.error(error);
    mostrarToast("Hubo un problema cargando los talleres. Recargá la página.", "error");
  }
});
