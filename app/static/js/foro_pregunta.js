let sesionActual = null;
const preguntaId = window.__PREGUNTA_ID__;

function formatearFechaForo(iso) {
  return new Date(iso).toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function cargarPregunta() {
  const { data: pregunta, error } = await supabaseClient
    .from("foro_preguntas")
    .select("*, profiles(username)")
    .eq("id", preguntaId)
    .maybeSingle();

  const contenedor = document.getElementById("pregunta-detalle");
  if (error || !pregunta) {
    contenedor.innerHTML = "<p>No se encontró esta pregunta.</p>";
    return;
  }

  const autor = pregunta.profiles ? pregunta.profiles.username : "Usuario";
  contenedor.innerHTML = `
    <h1></h1>
    <div class="pregunta-meta">por ${escaparHtml(autor)} · ${formatearFechaForo(pregunta.created_at)}</div>
    <div class="pregunta-contenido"></div>
  `;
  contenedor.querySelector("h1").textContent = pregunta.titulo;
  contenedor.querySelector(".pregunta-contenido").textContent = pregunta.contenido;
}

async function cargarRespuestas() {
  const { data: respuestas, error } = await supabaseClient
    .from("foro_respuestas")
    .select("*, profiles(username)")
    .eq("pregunta_id", preguntaId)
    .order("created_at", { ascending: true });

  if (error) {
    mostrarToast("No se pudieron cargar las respuestas.", "error");
    return;
  }

  const lista = document.getElementById("lista-respuestas");
  lista.innerHTML = "";

  if (!respuestas || respuestas.length === 0) {
    document.getElementById("sin-respuestas").hidden = false;
    return;
  }
  document.getElementById("sin-respuestas").hidden = true;

  respuestas.forEach((respuesta) => {
    const autor = respuesta.profiles ? respuesta.profiles.username : "Usuario";
    const card = document.createElement("div");
    card.className = "tarjeta-respuesta";
    card.innerHTML = `
      <span class="respuesta-autor">${escaparHtml(autor)}</span>
      <span class="respuesta-fecha">${formatearFechaForo(respuesta.created_at)}</span>
      <div class="respuesta-contenido"></div>
    `;
    card.querySelector(".respuesta-contenido").textContent = respuesta.contenido;
    lista.appendChild(card);
  });
}

function configurarFormRespuesta() {
  document.getElementById("form-respuesta").addEventListener("submit", async (e) => {
    e.preventDefault();
    const textarea = document.getElementById("contenido-respuesta");
    const contenido = textarea.value.trim();
    if (!contenido) return;

    const btn = document.getElementById("btn-enviar-respuesta");
    btn.disabled = true;

    const { error } = await supabaseClient.from("foro_respuestas").insert({
      pregunta_id: preguntaId,
      user_id: sesionActual.user.id,
      contenido,
    });

    btn.disabled = false;
    if (error) {
      mostrarToast(error.message, "error");
      return;
    }
    textarea.value = "";
    mostrarToast("Respuesta publicada.", "success");
    await cargarRespuestas();
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    sesionActual = await requerirAutenticacion("/login");
    if (!sesionActual) return;

    configurarFormRespuesta();
    await cargarPregunta();
    await cargarRespuestas();
  } catch (error) {
    console.error(error);
    mostrarToast("Hubo un problema cargando la pregunta. Recargá la página.", "error");
  }
});
