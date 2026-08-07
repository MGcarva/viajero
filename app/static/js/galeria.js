const BUCKET_FOTOS = "fotos-viajes";
const TAMANO_MAX_BYTES = 5 * 1024 * 1024;

let sesionActual = null;

function formatearFechaFoto(iso) {
  return new Date(iso).toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function crearTarjetaFoto(foto) {
  const card = document.createElement("div");
  card.className = "tarjeta-foto";

  const img = document.createElement("img");
  img.src = foto.url;
  img.alt = foto.descripcion || "Foto de viaje";
  img.loading = "lazy";

  const info = document.createElement("div");
  info.className = "tarjeta-foto-info";

  const autor = document.createElement("span");
  autor.className = "tarjeta-foto-autor";
  autor.textContent = foto.profiles ? foto.profiles.username : "Usuario";

  const fecha = document.createElement("span");
  fecha.className = "tarjeta-foto-fecha";
  fecha.textContent = formatearFechaFoto(foto.created_at);

  info.appendChild(autor);
  info.appendChild(fecha);

  if (foto.descripcion) {
    const descripcion = document.createElement("div");
    descripcion.className = "tarjeta-foto-descripcion";
    descripcion.textContent = foto.descripcion;
    info.appendChild(descripcion);
  }

  if (sesionActual && foto.user_id === sesionActual.user.id) {
    const btnEliminar = document.createElement("button");
    btnEliminar.type = "button";
    btnEliminar.className = "tarjeta-foto-eliminar";
    btnEliminar.textContent = "Eliminar";
    btnEliminar.addEventListener("click", () => eliminarFoto(foto, card));
    info.appendChild(btnEliminar);
  }

  card.appendChild(img);
  card.appendChild(info);
  return card;
}

async function cargarFotos() {
  const { data: fotos, error } = await supabaseClient
    .from("fotos")
    .select("*, profiles(username)")
    .order("created_at", { ascending: false })
    .limit(60);

  if (error) {
    mostrarToast("No se pudieron cargar las fotos.", "error");
    return;
  }

  const galeria = document.getElementById("galeria-fotos");
  galeria.innerHTML = "";

  if (!fotos || fotos.length === 0) {
    document.getElementById("sin-fotos").hidden = false;
    return;
  }
  document.getElementById("sin-fotos").hidden = true;

  fotos.forEach((foto) => galeria.appendChild(crearTarjetaFoto(foto)));
}

async function eliminarFoto(foto, card) {
  if (!confirm("¿Eliminar esta foto?")) return;

  const { error } = await supabaseClient.from("fotos").delete().eq("id", foto.id);
  if (error) {
    mostrarToast(error.message, "error");
    return;
  }

  const ruta = foto.url.split(`/${BUCKET_FOTOS}/`)[1];
  if (ruta) {
    await supabaseClient.storage.from(BUCKET_FOTOS).remove([ruta]);
  }

  card.remove();
  mostrarToast("Foto eliminada.", "success");

  if (document.getElementById("galeria-fotos").children.length === 0) {
    document.getElementById("sin-fotos").hidden = false;
  }
}

async function subirFoto(e) {
  e.preventDefault();
  const input = document.getElementById("input-foto");
  const descripcion = document.getElementById("descripcion-foto").value.trim();
  const archivo = input.files[0];

  if (!archivo) return;
  if (!archivo.type.startsWith("image/")) {
    mostrarToast("Elegí un archivo de imagen.", "error");
    return;
  }
  if (archivo.size > TAMANO_MAX_BYTES) {
    mostrarToast("La imagen no puede pesar más de 5 MB.", "error");
    return;
  }

  const btn = document.getElementById("btn-subir-foto");
  btn.disabled = true;
  btn.textContent = "Subiendo...";

  const extension = archivo.name.includes(".") ? archivo.name.split(".").pop() : "jpg";
  const ruta = `${sesionActual.user.id}/${Date.now()}.${extension}`;

  const { error: errorSubida } = await supabaseClient.storage
    .from(BUCKET_FOTOS)
    .upload(ruta, archivo);

  if (errorSubida) {
    mostrarToast(errorSubida.message, "error");
    btn.disabled = false;
    btn.textContent = "Subir foto";
    return;
  }

  const { data: publica } = supabaseClient.storage.from(BUCKET_FOTOS).getPublicUrl(ruta);

  const { error: errorInsert } = await supabaseClient.from("fotos").insert({
    user_id: sesionActual.user.id,
    url: publica.publicUrl,
    descripcion: descripcion || null,
  });

  btn.disabled = false;
  btn.textContent = "Subir foto";

  if (errorInsert) {
    mostrarToast(errorInsert.message, "error");
    return;
  }

  document.getElementById("form-foto").reset();
  mostrarToast("Foto subida.", "success");
  await cargarFotos();
}

document.addEventListener("DOMContentLoaded", async () => {
  sesionActual = await requerirAutenticacion("/login");
  if (!sesionActual) return;

  await cargarFotos();
  document.getElementById("form-foto").addEventListener("submit", subirFoto);
});
