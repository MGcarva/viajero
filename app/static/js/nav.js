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

async function pintarNav() {
  const sesion = await obtenerSesion();
  const nav = document.getElementById("nav-sesion");
  const nombre = document.getElementById("nav-username");
  if (!nav) return;
  if (sesion) {
    nav.hidden = false;
    if (nombre) {
      const { data: perfil } = await supabaseClient
        .from("profiles")
        .select("username")
        .eq("id", sesion.user.id)
        .single();
      nombre.textContent = perfil ? perfil.username : sesion.user.email;
    }
  } else {
    nav.hidden = true;
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
