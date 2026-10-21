// Mercado Pago avisa acá cada vez que cambia un pago de la tienda.
// No le creemos al aviso: con el número de pago le preguntamos a Mercado
// Pago directamente cómo está. Si está aprobado, marcamos la venta como
// pagada (una sola vez) y mandamos el mail con el PDF.
import { sb, tokenNuevo, mandarMailDescarga, DIAS_LINK } from "./_tienda.js";

export default async function handler(req, res) {
  try {
    const tipo = req.query.type || req.query.topic || req.body?.type || req.body?.topic;
    const pagoId = req.query["data.id"] || req.query.id || req.body?.data?.id;
    if (tipo !== "payment" || !pagoId) {
      res.status(200).json({ recibido: true });
      return;
    }

    const resp = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(pagoId)}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
    });
    const pago = await resp.json();
    if (!resp.ok) {
      console.error("No se pudo consultar el pago:", JSON.stringify(pago));
      res.status(200).json({ recibido: true });
      return;
    }

    const ventaId = pago.external_reference;
    if (!ventaId || pago.status !== "approved") {
      res.status(200).json({ recibido: true });
      return;
    }

    const [venta] = await sb(`tienda_ventas?id=eq.${encodeURIComponent(ventaId)}&select=*`);
    if (!venta) {
      res.status(200).json({ recibido: true });
      return;
    }
    if (Number(pago.transaction_amount) < Number(venta.monto)) {
      console.error(`Pago ${pagoId} por menos de lo esperado (${pago.transaction_amount} < ${venta.monto})`);
      res.status(200).json({ recibido: true });
      return;
    }

    // Solo la primera vez que llega el aviso de "aprobado" cambia la venta
    // (el filtro estado=neq.pagada evita mandar el mail dos veces).
    const token = tokenNuevo();
    const vence = new Date(Date.now() + DIAS_LINK * 24 * 60 * 60 * 1000).toISOString();
    const actualizadas = await sb(`tienda_ventas?id=eq.${venta.id}&estado=neq.pagada`, {
      method: "PATCH",
      prefer: "return=representation",
      body: {
        estado: "pagada",
        mp_payment_id: String(pago.id),
        token_descarga: token,
        vence_descarga: vence,
        pagado_at: new Date().toISOString(),
      },
    });
    if (!actualizadas?.length) {
      res.status(200).json({ recibido: true });
      return;
    }

    const [material] = await sb(`tienda_materiales?id=eq.${encodeURIComponent(venta.material_id)}&select=titulo`);
    try {
      await mandarMailDescarga({ email: venta.email, titulo: material?.titulo || "Tu material", token });
      await sb(`tienda_ventas?id=eq.${venta.id}`, { method: "PATCH", body: { mail_enviado: true } });
    } catch (err) {
      // El pago quedó registrado igual: desde el panel lo podés reenviar.
      console.error("No se pudo mandar el mail de la venta", venta.id, err);
    }
    res.status(200).json({ recibido: true });
  } catch (err) {
    console.error("Error en tienda-webhook:", err);
    // Respondemos 200 igual para que Mercado Pago no reintente sin parar.
    res.status(200).json({ recibido: true });
  }
}
