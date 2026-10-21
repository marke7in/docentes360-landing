// Funciones compartidas de la Tienda. Corren en el SERVIDOR de Vercel: acá
// se usan las claves secretas (Supabase service role, Mercado Pago, Resend),
// que nunca llegan al navegador. El guion bajo del nombre hace que Vercel no
// lo publique como una dirección propia.

import { randomBytes } from "crypto";

export const ADMIN_UID = "eada8be4-1423-4c28-aeb5-861dc21a9cd7";
export const SITIO = "https://docentes360.com.ar";
export const DIAS_LINK = 30; // el enlace de descarga dura 30 días
export const MAX_DESCARGAS = 10; // y se puede usar hasta 10 veces

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Consulta a la base de datos con permisos de administrador.
export async function sb(ruta, { method = "GET", body, prefer } = {}) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${ruta}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const texto = await resp.text();
  const datos = texto ? JSON.parse(texto) : null;
  if (!resp.ok) throw new Error(`Supabase ${resp.status}: ${texto}`);
  return datos;
}

// Enlace firmado y temporal (2 minutos) para bajar un PDF del depósito privado.
export async function enlaceFirmado(ruta, nombreArchivo) {
  const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/tienda-pdf/${ruta}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 120 }),
  });
  const datos = await resp.json();
  if (!resp.ok || !datos.signedURL) throw new Error(`No se pudo firmar el archivo: ${JSON.stringify(datos)}`);
  const separador = datos.signedURL.includes("?") ? "&" : "?";
  return `${SUPABASE_URL}/storage/v1${datos.signedURL}${separador}download=${encodeURIComponent(nombreArchivo)}`;
}

// Devuelve el usuario dueño del token de sesión, o null.
export async function usuarioDelToken(token) {
  if (!token) return null;
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return null;
  return resp.json();
}

export const escaparHtml = (texto) =>
  String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const emailValido = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || "").trim());

export const tokenNuevo = () => randomBytes(24).toString("hex");

export const nombreArchivoPdf = (titulo) =>
  `${String(titulo || "material")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "material"}.pdf`;

// Manda el mail con el enlace de descarga.
export async function mandarMailDescarga({ email, titulo, token }) {
  const enlace = `${SITIO}/api/tienda-descarga?t=${token}`;
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1F2B26">
    <div style="background:#1F332B;color:#F2EFE6;padding:22px 24px;border-radius:12px 12px 0 0">
      <div style="font-size:20px;font-weight:bold">Docentes360</div>
      <div style="opacity:.8;font-size:13px">Tienda de materiales</div>
    </div>
    <div style="background:#F2EFE6;padding:24px;border-radius:0 0 12px 12px">
      <p style="font-size:16px;margin:0 0 10px">¡Gracias por tu compra! 🎉</p>
      <p style="margin:0 0 18px">Acá tenés tu material: <b>${escaparHtml(titulo)}</b></p>
      <p style="text-align:center;margin:0 0 18px">
        <a href="${enlace}" style="display:inline-block;background:#E8B94A;color:#1F332B;text-decoration:none;font-weight:bold;padding:14px 26px;border-radius:8px">Descargar PDF</a>
      </p>
      <p style="font-size:13px;opacity:.75;margin:0 0 20px">El enlace funciona durante ${DIAS_LINK} días y hasta ${MAX_DESCARGAS} descargas. Guardá el PDF en tu compu o en tu celular. Si tenés algún problema, respondé este mail.</p>
      <div style="border-top:1px solid #d9d3c2;padding-top:16px;font-size:14px">
        <b>¿Ya conocés la app Docentes360?</b><br>
        Asistencia, notas, trabajos y horario en un solo lugar.
        <a href="https://app.docentes360.com.ar/" style="color:#2B4339;font-weight:bold">Probala 15 días gratis</a>.
      </div>
    </div>
  </div>`;
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Docentes360 <noreply@docentes360.com.ar>",
      to: email,
      reply_to: "marke7in@gmail.com",
      subject: `Tu material: ${titulo}`,
      html,
    }),
  });
  if (!resp.ok) throw new Error(`Resend ${resp.status}: ${await resp.text()}`);
}
