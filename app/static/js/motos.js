const BUCKET_MOTOS = "motos-venta";
const TAMANO_MAX_BYTES = 5 * 1024 * 1024;

let sesionActual = null;

function formatearPrecio(precio) {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(
    precio
  );
}

function generarLinkContacto(contacto) {
  const limpio = contacto.trim();
  const soloDigitos = limpio.replace(/[^\d]/g, "");
  const sinFormato = limpio.replace(/[\s()+-]/g, "");
  if (soloDigitos.length >= 8 && soloDigitos === sinFormato) {
    return { texto: "💬 Contactar por WhatsApp", href: `https://wa.me/${soloDigitos}` };
  }
  if (limpio.includes("@")) {
    return { texto: "✉️ Contactar por email", href: `mailto:${limpio}` };
  }
  return null;
}

function crearTarjetaMoto(moto) {
  const card = document.createElement("div");
  card.className = "tarjeta-moto" + (moto.vendida ? " vendida" : "");

  if (moto.foto_url) {
    const img = document.createElement("img");
    img.src = moto.foto_url;
    img.alt = `${moto.marca} ${moto.modelo}`;
    img.loading = "lazy";
    card.appendChild(img);
  }

  const info = document.createElement("div");
  info.className = "tarjeta-moto-info";

  if (moto.vendida) {
    const badge = document.createElement("span");
    badge.className = "badge-vendida";
    badge.textContent = "VENDIDA";
    info.appendChild(badge);
  }

  const titulo = document.createElement("h3");
  titulo.textContent = `${moto.marca} ${moto.modelo}${moto.anio ? " " + moto.anio : ""}`;
  info.appendChild(titulo);

  const precio = document.createElement("div");
  precio.className = "tarjeta-moto-precio";
  precio.textContent = formatearPrecio(moto.precio);
  info.appendChild(precio);

  const detalle = document.createElement("div");
  detalle.className = "tarjeta-moto-detalle";
  const partes = [];
  if (moto.kilometraje != null) partes.push(`${moto.kilometraje.toLocaleString("es-CL")} km`);
  if (moto.ubicacion) partes.push(moto.ubicacion);
  detalle.textContent = partes.join(" · ");
  info.appendChild(detalle);

  if (moto.descripcion) {
    const descripcion = document.createElement("div");
    descripcion.className = "tarjeta-moto-detalle";
    descripcion.textContent = moto.descripcion;
    info.appendChild(descripcion);
  }

  const acciones = document.createElement("div");
  acciones.className = "tarjeta-moto-acciones";

  const contacto = generarLinkContacto(moto.contacto);
  if (contacto) {
    const link = document.createElement("a");
    link.href = contacto.href;
    link.target = "_blank";
    link.rel = "noopener";
    link.className = "btn-contactar";
    link.textContent = contacto.texto;
    acciones.appendChild(link);
  } else {
    const texto = document.createElement("span");
    texto.className = "tarjeta-moto-detalle";
    texto.textContent = `Contacto: ${moto.contacto}`;
    acciones.appendChild(texto);
  }

  if (sesionActual && moto.user_id === sesionActual.user.id && !moto.vendida) {
    const btnVendida = document.createElement("button");
    btnVendida.type = "button";
    btnVendida.className = "btn-marcar-vendida";
    btnVendida.textContent = "Marcar vendida";
    btnVendida.addEventListener("click", () => marcarVendida(moto.id));
    acciones.appendChild(btnVendida);
  }

  info.appendChild(acciones);
  card.appendChild(info);
  return card;
}

async function cargarMotos() {
  const { data: motos, error } = await supabaseClient
    .from("motos_venta")
    .select("*")
    .order("vendida", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    mostrarToast("No se pudieron cargar las motos.", "error");
    return;
  }

  const grilla = document.getElementById("grilla-motos");
  grilla.innerHTML = "";

  if (!motos || motos.length === 0) {
    document.getElementById("sin-motos").hidden = false;
    return;
  }
  document.getElementById("sin-motos").hidden = true;

  motos.forEach((moto) => grilla.appendChild(crearTarjetaMoto(moto)));
}

async function marcarVendida(id) {
  const { error } = await supabaseClient.from("motos_venta").update({ vendida: true }).eq("id", id);
  if (error) {
    mostrarToast(error.message, "error");
    return;
  }
  mostrarToast("Marcada como vendida.", "success");
  await cargarMotos();
}

function configurarModalMoto() {
  const dialogo = document.getElementById("dialog-moto");
  document.getElementById("btn-abrir-moto").addEventListener("click", () => dialogo.showModal());
  document.getElementById("btn-cancelar-moto").addEventListener("click", () => dialogo.close());

  document.getElementById("form-moto").addEventListener("submit", async (e) => {
    e.preventDefault();
    const marca = document.getElementById("marca-moto").value.trim();
    const modelo = document.getElementById("modelo-moto").value.trim();
    const anio = document.getElementById("anio-moto").value || null;
    const km = document.getElementById("km-moto").value || null;
    const precio = document.getElementById("precio-moto").value;
    const ubicacion = document.getElementById("ubicacion-moto").value.trim();
    const contacto = document.getElementById("contacto-moto").value.trim();
    const descripcion = document.getElementById("descripcion-moto").value.trim();
    const archivo = document.getElementById("foto-moto").files[0];

    if (archivo && archivo.size > TAMANO_MAX_BYTES) {
      mostrarToast("La imagen no puede pesar más de 5 MB.", "error");
      return;
    }

    const btn = document.getElementById("btn-confirmar-moto");
    btn.disabled = true;
    btn.textContent = "Publicando...";

    let fotoUrl = null;
    if (archivo) {
      const extension = archivo.name.includes(".") ? archivo.name.split(".").pop() : "jpg";
      const ruta = `${sesionActual.user.id}/${Date.now()}.${extension}`;
      const { error: errorSubida } = await supabaseClient.storage.from(BUCKET_MOTOS).upload(ruta, archivo);
      if (errorSubida) {
        mostrarToast(errorSubida.message, "error");
        btn.disabled = false;
        btn.textContent = "Publicar";
        return;
      }
      const { data: publica } = supabaseClient.storage.from(BUCKET_MOTOS).getPublicUrl(ruta);
      fotoUrl = publica.publicUrl;
    }

    const { error } = await supabaseClient.from("motos_venta").insert({
      user_id: sesionActual.user.id,
      marca,
      modelo,
      anio: anio ? parseInt(anio, 10) : null,
      kilometraje: km ? parseInt(km, 10) : null,
      precio: parseFloat(precio),
      ubicacion: ubicacion || null,
      contacto,
      descripcion: descripcion || null,
      foto_url: fotoUrl,
    });

    btn.disabled = false;
    btn.textContent = "Publicar";

    if (error) {
      mostrarToast(error.message, "error");
      return;
    }

    document.getElementById("form-moto").reset();
    dialogo.close();
    mostrarToast("Moto publicada.", "success");
    await cargarMotos();
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    sesionActual = await requerirAutenticacion("/login");
    if (!sesionActual) return;

    configurarModalMoto();
    await cargarMotos();
  } catch (error) {
    console.error(error);
    mostrarToast("Hubo un problema cargando la sección. Recargá la página.", "error");
  }
});
