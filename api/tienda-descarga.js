// El botón "Descargar PDF" del mail llega acá. Revisamos que el enlace sea
// de una venta pagada, que no haya vencido y que no se haya usado de más;
// si está todo bien, mandamos al PDF con un enlace que dura 2 minutos.
import { sb, enlaceFirmado, nombreArchivoPdf, escaparHtml, MAX_DESCARGAS } from "./_tienda.js";

const pagina = (titulo, texto) => `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escaparHtml(titulo)} — Docentes360</title></head>
<body style="margin:0;background:#F2EFE6;font-family:Arial,Helvetica,sans-serif;color:#1F2B26">
<div style="max-width:480px;margin:60px auto;padding:28px;background:#fff;border-radius:14px;border:1px solid #ddd6c4;text-align:center">
<div style="font-size:20px;font-weight:bold;margin-bottom:10px">${escaparHtml(titulo)}</div>
<p style="line-height:1.5">${texto}</p>
<p><a href="https://docentes360.com.ar/tienda.html" style="color:#2B4339;font-weight:bold">Ir a la Tienda</a></p>
</div></body></html>`;

export default async function handler(req, res) {
  const token = String(req.query.t || "");
  res.setHeader("Cache-Control", "no-store");
  if (!/^[a-f0-9]{48}$/.test(token)) {
    res.status(400).setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(pagina("Enlace no válido", "Revisá que hayas abierto el enlace completo del mail."));
    return;
  }
  try {
    const [venta] = await sb(`tienda_ventas?token_descarga=eq.${token}&estado=eq.pagada&select=id,material_id,descargas,vence_descarga`);
    const contacto = 'Escribinos a <a href="mailto:marke7in@gmail.com">marke7in@gmail.com</a> y te lo mandamos de nuevo.';
    if (!venta) {
      res.status(404).setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(pagina("No encontramos tu compra", `Puede que el enlace esté incompleto. ${contacto}`));
      return;
    }
    if (venta.vence_descarga && new Date(venta.vence_descarga) < new Date()) {
      res.status(410).setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(pagina("El enlace venció", `Este enlace ya no está activo. ${contacto}`));
      return;
    }
    if ((venta.descargas || 0) >= MAX_DESCARGAS) {
      res.status(429).setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(pagina("Llegaste al límite de descargas", `Este enlace ya se usó ${MAX_DESCARGAS} veces. ${contacto}`));
      return;
    }

    const [material] = await sb(`tienda_materiales?id=eq.${encodeURIComponent(venta.material_id)}&select=titulo,archivo_path`);
    if (!material?.archivo_path) {
      res.status(404).setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(pagina("No encontramos el archivo", contacto));
      return;
    }

    await sb(`tienda_ventas?id=eq.${venta.id}`, { method: "PATCH", body: { descargas: (venta.descargas || 0) + 1 } });
    const url = await enlaceFirmado(material.archivo_path, nombreArchivoPdf(material.titulo));
    res.writeHead(302, { Location: url });
    res.end();
  } catch (err) {
    console.error("Error en tienda-descarga:", err);
    res.status(500).setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(pagina("Hubo un problema", "Probá de nuevo en unos minutos."));
  }
}
