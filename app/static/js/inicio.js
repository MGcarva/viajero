const CIUDADES_FRECUENTES = [
  { nombre: "Santiago", lat: -33.4489, lng: -70.6693 },
  { nombre: "Valparaíso", lat: -33.0472, lng: -71.6127 },
  { nombre: "La Serena", lat: -29.9027, lng: -71.2519 },
  { nombre: "Pucón", lat: -39.2828, lng: -71.9744 },
  { nombre: "Puerto Varas", lat: -41.3195, lng: -72.9856 },
];

function iniciarCarrusel() {
  const track = document.getElementById("carrusel-track");
  const dotsContenedor = document.getElementById("carrusel-dots");
  if (!track || !dotsContenedor) return;

  const total = track.children.length;
  if (total <= 1) return;

  let indice = 0;
  let temporizador = null;

  for (let i = 0; i < total; i++) {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "carrusel-dot" + (i === 0 ? " activo" : "");
    dot.setAttribute("aria-label", `Ir a la imagen ${i + 1}`);
    dot.addEventListener("click", () => ir(i));
    dotsContenedor.appendChild(dot);
  }

  function ir(nuevoIndice) {
    indice = (nuevoIndice + total) % total;
    track.style.transform = `translateX(-${indice * 100}%)`;
    Array.from(dotsContenedor.children).forEach((dot, i) => {
      dot.classList.toggle("activo", i === indice);
    });
  }

  function reiniciarAutoavance() {
    if (temporizador) clearInterval(temporizador);
    temporizador = setInterval(() => ir(indice + 1), 4000);
  }

  document.getElementById("carrusel-prev").addEventListener("click", () => {
    ir(indice - 1);
    reiniciarAutoavance();
  });
  document.getElementById("carrusel-next").addEventListener("click", () => {
    ir(indice + 1);
    reiniciarAutoavance();
  });
  dotsContenedor.addEventListener("click", reiniciarAutoavance);

  const carrusel = document.getElementById("carrusel");
  carrusel.addEventListener("mouseenter", () => temporizador && clearInterval(temporizador));
  carrusel.addEventListener("mouseleave", reiniciarAutoavance);

  reiniciarAutoavance();
}

async function cargarClimaCiudades() {
  const contenedor = document.getElementById("clima-ciudades");
  const hoy = new Date().toISOString().split("T")[0];

  contenedor.innerHTML = CIUDADES_FRECUENTES.map(
    (c) => `<div class="tarjeta-clima-ciudad"><div class="ciudad-nombre">${c.nombre}</div>Cargando...</div>`
  ).join("");

  // Secuencial, no en paralelo, para no saturar el servicio de clima.
  for (const ciudad of CIUDADES_FRECUENTES) {
    try {
      const resp = await fetch(`/api/clima?lat=${ciudad.lat}&lng=${ciudad.lng}&fecha=${hoy}`);
      if (!resp.ok) throw new Error("sin datos");
      const clima = await resp.json();
      actualizarTarjetaClima(ciudad.nombre, clima);
    } catch (error) {
      actualizarTarjetaClima(ciudad.nombre, null);
    }
  }
}

function actualizarTarjetaClima(nombreCiudad, clima) {
  const contenedor = document.getElementById("clima-ciudades");
  const indice = CIUDADES_FRECUENTES.findIndex((c) => c.nombre === nombreCiudad);
  if (indice === -1) return;
  const tarjeta = contenedor.children[indice];
  if (!tarjeta) return;

  if (!clima) {
    tarjeta.innerHTML = `<div class="ciudad-nombre">${nombreCiudad}</div><div class="mensaje-vacio">Sin datos</div>`;
    return;
  }
  tarjeta.innerHTML = `
    <div class="ciudad-nombre">${nombreCiudad}</div>
    <div class="ciudad-emoji">${clima.emoji}</div>
    <div class="ciudad-temp">${clima.temp_min}° / ${clima.temp_max}°C</div>
  `;
}

async function cargarPreviewFotos() {
  const contenedor = document.getElementById("preview-fotos");
  const { data: fotos, error } = await supabaseClient
    .from("fotos")
    .select("url, descripcion")
    .order("created_at", { ascending: false })
    .limit(6);

  if (error || !fotos || fotos.length === 0) {
    contenedor.innerHTML = '<p class="mensaje-vacio">Todavía no hay fotos de la comunidad. ¡Subí la primera!</p>';
    return;
  }

  contenedor.innerHTML = "";
  fotos.forEach((foto) => {
    const img = document.createElement("img");
    img.src = foto.url;
    img.alt = foto.descripcion || "Foto de viaje";
    img.loading = "lazy";
    contenedor.appendChild(img);
  });
}

async function iniciarPantallaInicio() {
  try {
    iniciarCarrusel();
    await cargarClimaCiudades();
    await cargarPreviewFotos();
  } catch (error) {
    console.error(error);
    mostrarToast("Hubo un problema cargando el inicio. Recargá la página.", "error");
  }
}

document.addEventListener("DOMContentLoaded", iniciarPantallaInicio);
