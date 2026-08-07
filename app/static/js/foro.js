let sesionActual = null;

function formatearFechaForo(iso) {
  return new Date(iso).toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

async function cargarPreguntas() {
  const { data: preguntas, error } = await supabaseClient
    .from("foro_preguntas")
    .select("*, profiles(username)")
    .order("created_at", { ascending: false });

  if (error) {
    mostrarToast("No se pudieron cargar las preguntas.", "error");
    return;
  }

  if (!preguntas || preguntas.length === 0) {
    document.getElementById("sin-preguntas").hidden = false;
    return;
  }
  document.getElementById("sin-preguntas").hidden = true;

  const ids = preguntas.map((p) => p.id);
  const { data: respuestas } = await supabaseClient
    .from("foro_respuestas")
    .select("pregunta_id")
    .in("pregunta_id", ids);

  const conteoPorPregunta = new Map();
  (respuestas || []).forEach((r) => {
    conteoPorPregunta.set(r.pregunta_id, (conteoPorPregunta.get(r.pregunta_id) || 0) + 1);
  });

  const lista = document.getElementById("lista-preguntas");
  lista.innerHTML = "";
  preguntas.forEach((pregunta) => {
    const autor = pregunta.profiles ? pregunta.profiles.username : "Usuario";
    const cantidadRespuestas = conteoPorPregunta.get(pregunta.id) || 0;
    const card = document.createElement("a");
    card.href = `/foro/${pregunta.id}`;
    card.className = "tarjeta-pregunta";
    card.innerHTML = `
      <h3>${escaparHtml(pregunta.titulo)}</h3>
      <p>por ${escaparHtml(autor)} · ${formatearFechaForo(pregunta.created_at)} · ${cantidadRespuestas} respuesta${cantidadRespuestas === 1 ? "" : "s"}</p>
    `;
    lista.appendChild(card);
  });
}

function configurarModalPregunta() {
  const dialogo = document.getElementById("dialog-pregunta");
  document.getElementById("btn-abrir-pregunta").addEventListener("click", () => dialogo.showModal());
  document.getElementById("btn-cancelar-pregunta").addEventListener("click", () => dialogo.close());

  document.getElementById("form-pregunta").addEventListener("submit", async (e) => {
    e.preventDefault();
    const titulo = document.getElementById("titulo-pregunta").value.trim();
    const contenido = document.getElementById("contenido-pregunta").value.trim();
    const btn = document.getElementById("btn-confirmar-pregunta");
    btn.disabled = true;

    const { error } = await supabaseClient.from("foro_preguntas").insert({
      user_id: sesionActual.user.id,
      titulo,
      contenido,
    });

    btn.disabled = false;
    if (error) {
      mostrarToast(error.message, "error");
      return;
    }
    document.getElementById("form-pregunta").reset();
    dialogo.close();
    mostrarToast("Pregunta publicada.", "success");
    await cargarPreguntas();
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    sesionActual = await requerirAutenticacion("/login");
    if (!sesionActual) return;

    configurarModalPregunta();
    await cargarPreguntas();
  } catch (error) {
    console.error(error);
    mostrarToast("Hubo un problema cargando el foro. Recargá la página.", "error");
  }
});
