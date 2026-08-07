async function obtenerSesion() {
  const { data } = await supabaseClient.auth.getSession();
  return data.session;
}

async function redirigirSiAutenticado(destino = "/") {
  const sesion = await obtenerSesion();
  if (sesion) window.location.href = destino;
  return sesion;
}

async function requerirAutenticacion(destino = "/login") {
  const sesion = await obtenerSesion();
  if (!sesion) {
    window.location.href = destino;
    return null;
  }
  return sesion;
}

// Para acciones puntuales (publicar, reseñar, escribir) en páginas que por
// lo demás se pueden navegar sin cuenta: si no hay sesión, avisa y manda a
// registrarse en vez de bloquear toda la página.
async function requerirCuentaParaAccion(mensaje = "Creá una cuenta gratis para hacer esto.") {
  const sesion = await obtenerSesion();
  if (!sesion) {
    mostrarToast(mensaje, "info");
    window.location.href = "/registro";
    return null;
  }
  return sesion;
}

async function pintarNav() {
  const sesion = await obtenerSesion();
  const navSesion = document.getElementById("nav-sesion");
  const navInvitado = document.getElementById("nav-invitado");
  const nombre = document.getElementById("nav-username");

  if (sesion) {
    if (navSesion) navSesion.hidden = false;
    if (navInvitado) navInvitado.hidden = true;
    if (nombre) {
      const { data: perfil } = await supabaseClient
        .from("profiles")
        .select("username")
        .eq("id", sesion.user.id)
        .single();
      nombre.textContent = perfil ? perfil.username : sesion.user.email;
    }
  } else {
    if (navSesion) navSesion.hidden = true;
    if (navInvitado) navInvitado.hidden = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  pintarNav();
  const btnLogout = document.getElementById("btn-logout");
  if (btnLogout) {
    btnLogout.addEventListener("click", async () => {
      await supabaseClient.auth.signOut();
      window.location.href = "/login";
    });
  }
});
