// Solo para vos (administrador): reenvía el mail de una venta pagada con un
// enlace nuevo (otros 30 días y 10 descargas). También sirve para mandar el
// material a mano si alguien te pagó por otro lado: con "marcarPagada".
import { sb, usuarioDelToken, ADMIN_UID, tokenNuevo, mandarMailDescarga, DIAS_LINK } from "./_tienda.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido" });
    return;
  }
  const usuario = await usuarioDelToken(req.headers.authorization?.replace("Bearer ", ""));
  if (!usuario || usuario.id !== ADMIN_UID) {
    res.status(403).json({ error: "No autorizado" });
    return;
  }

  const ventaId = String(req.body?.ventaId || "");
  const nuevoEmail = String(req.body?.email || "").trim().toLowerCase();
  try {
    const [venta] = await sb(`tienda_ventas?id=eq.${encodeURIComponent(ventaId)}&select=*`);
    if (!venta) {
      res.status(404).json({ error: "No existe esa venta" });
      return;
    }
    if (venta.estado !== "pagada" && !req.body?.marcarPagada) {
      res.status(400).json({ error: "Esa venta no está pagada." });
      return;
    }
    const token = tokenNuevo();
    const email = nuevoEmail || venta.email;
    await sb(`tienda_ventas?id=eq.${venta.id}`, {
      method: "PATCH",
      body: {
        estado: "pagada",
        email,
        token_descarga: token,
        descargas: 0,
        vence_descarga: new Date(Date.now() + DIAS_LINK * 24 * 60 * 60 * 1000).toISOString(),
        pagado_at: venta.pagado_at || new Date().toISOString(),
      },
    });
    const [material] = await sb(`tienda_materiales?id=eq.${encodeURIComponent(venta.material_id)}&select=titulo`);
    await mandarMailDescarga({ email, titulo: material?.titulo || "Tu material", token });
    await sb(`tienda_ventas?id=eq.${venta.id}`, { method: "PATCH", body: { mail_enviado: true } });
    res.status(200).json({ ok: true, email });
  } catch (err) {
    console.error("Error en tienda-reenviar:", err);
    res.status(500).json({ error: "No se pudo reenviar. Revisá los logs." });
  }
}
