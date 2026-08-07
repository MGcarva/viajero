document.addEventListener("DOMContentLoaded", async () => {
  const sesion = await requerirAutenticacion("/login");
  if (!sesion) return;

  document.getElementById("form-anuncio").addEventListener("submit", async (e) => {
    e.preventDefault();
    const empresa = document.getElementById("empresa-anuncio").value.trim();
    const contacto = document.getElementById("contacto-anuncio").value.trim();
    const mensaje = document.getElementById("mensaje-anuncio").value.trim();
    const btn = document.getElementById("btn-enviar-anuncio");
    btn.disabled = true;
    btn.textContent = "Enviando...";

    const { error } = await supabaseClient.from("solicitudes_publicidad").insert({
      empresa,
      contacto,
      mensaje: mensaje || null,
    });

    btn.disabled = false;
    btn.textContent = "Enviar";

    if (error) {
      mostrarToast(error.message, "error");
      return;
    }
    document.getElementById("form-anuncio").reset();
    mostrarToast("¡Gracias! Te vamos a contactar pronto.", "success");
  });
});
