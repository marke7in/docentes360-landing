// La tienda pide comprar un material: anotamos la venta como "pendiente" y
// creamos el pago en Mercado Pago. El precio SIEMPRE sale de la base de
// datos (nunca del navegador), así nadie puede cambiarlo.
import { sb, SITIO, emailValido } from "./_tienda.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido" });
    return;
  }
  const materialId = String(req.body?.materialId || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!materialId) {
    res.status(400).json({ error: "Falta el material." });
    return;
  }
  if (!emailValido(email)) {
    res.status(400).json({ error: "Revisá el mail: tiene que ser algo como nombre@gmail.com" });
    return;
  }

  try {
    const filas = await sb(`tienda_materiales?id=eq.${encodeURIComponent(materialId)}&activo=eq.true&select=id,titulo,precio,archivo_path`);
    const material = filas?.[0];
    if (!material || !material.archivo_path) {
      res.status(404).json({ error: "Ese material no está disponible en este momento." });
      return;
    }

    const [venta] = await sb("tienda_ventas", {
      method: "POST",
      prefer: "return=representation",
      body: { material_id: material.id, email, monto: material.precio, estado: "pendiente" },
    });

    const resp = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          {
            id: material.id,
            title: material.titulo,
            quantity: 1,
            unit_price: Number(material.precio),
            currency_id: "ARS",
          },
        ],
        payer: { email },
        external_reference: venta.id,
        notification_url: `${SITIO}/api/tienda-webhook`,
        back_urls: {
          success: `${SITIO}/tienda.html?compra=ok`,
          pending: `${SITIO}/tienda.html?compra=pendiente`,
          failure: `${SITIO}/tienda.html?compra=error`,
        },
        auto_return: "approved",
        statement_descriptor: "DOCENTES360",
      }),
    });
    const pref = await resp.json();
    if (!resp.ok || !pref.init_point) {
      console.error("Error creando la preferencia de Mercado Pago:", JSON.stringify(pref));
      res.status(502).json({ error: "No se pudo iniciar el pago. Probá de nuevo en un rato." });
      return;
    }

    await sb(`tienda_ventas?id=eq.${venta.id}`, { method: "PATCH", body: { mp_preference_id: pref.id } });
    res.status(200).json({ initPoint: pref.init_point });
  } catch (err) {
    console.error("Error en tienda-comprar:", err);
    res.status(500).json({ error: "Hubo un problema. Probá de nuevo en un rato." });
  }
}
