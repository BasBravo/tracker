/**
 * Servicio de envío de emails de alerta con Nodemailer.
 * Template HTML con producto(s), manejo de errores y log de envíos.
 */

import nodemailer, { Transporter } from "nodemailer";
import type { Product } from "../types";

export interface SmtpConfig {
  host: string;
  port: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  from: string;
}

export interface MatchItem {
  product: Product;
  confidenceScore?: number;
}

export interface SendAlertResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

const LOG_PREFIX = "[EmailService]";

/**
 * Obtiene la configuración SMTP desde variables de entorno.
 */
export function getSmtpConfigFromEnv(): SmtpConfig {
  const host = process.env.SMTP_HOST ?? "localhost";
  const port = parseInt(process.env.SMTP_PORT ?? "587", 10);
  const secure = process.env.SMTP_SECURE === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from =
    process.env.FROM_EMAIL ??
    process.env.SMTP_FROM ??
    process.env.MAIL_FROM ??
    "tracker@localhost";

  return { host, port, secure, user, pass, from };
}

let cachedTransporter: Transporter | null = null;

/**
 * Crea o reutiliza un transporter de Nodemailer.
 */
export function getTransporter(config?: SmtpConfig): Transporter {
  if (cachedTransporter) return cachedTransporter;
  const cfg = config ?? getSmtpConfigFromEnv();
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure ?? cfg.port === 465,
    auth:
      cfg.user && cfg.pass
        ? { user: cfg.user, pass: cfg.pass }
        : undefined,
  });
  cachedTransporter = transporter;
  return transporter;
}

/**
 * Escapa HTML para evitar inyección.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Genera el HTML de un bloque de producto (nombre, precio, talla, color, imagen, link).
 */
function productBlockHtml(item: MatchItem, index: number): string {
  const p = item.product;
  const name = escapeHtml(p.name);
  const price = `${p.price.toFixed(2)} ${escapeHtml(p.currency)}`;
  const size = p.size ? escapeHtml(p.size) : "—";
  const color = p.color ? escapeHtml(p.color) : "—";
  const url = p.url;
  const img = p.image && p.image.startsWith("http") ? p.image : "";
  const score = item.confidenceScore != null ? `Score: ${(item.confidenceScore * 100).toFixed(0)}%` : "";

  return `
    <tr>
      <td style="padding: 1rem; border: 1px solid #eee; vertical-align: top;">
        ${img ? `<img src="${escapeHtml(img)}" alt="${name}" style="max-width: 200px; height: auto; display: block; margin-bottom: 0.5rem;" />` : ""}
        <strong style="font-size: 1rem;">${name}</strong>
        ${score ? `<br /><span style="color: #666; font-size: 0.85rem;">${score}</span>` : ""}
        <p style="margin: 0.5rem 0 0 0; font-size: 1.1rem; color: #222;">${price}</p>
        <p style="margin: 0.25rem 0; font-size: 0.9rem; color: #555;">Talla: ${size} · Color: ${color}</p>
        <p style="margin: 0.5rem 0 0 0;"><a href="${escapeHtml(url)}" style="color: #1976d2;">Ver producto</a></p>
      </td>
    </tr>`;
}

/**
 * Genera el HTML completo del email de alerta (soporta múltiples matches).
 */
export function buildAlertHtml(matches: MatchItem[]): string {
  const productRows = matches.map((m, i) => productBlockHtml(m, i)).join("");
  const count = matches.length;
  const title = count === 1 ? "1 producto coincide con tu tracking" : `${count} productos coinciden con tu tracking`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 1rem; background: #f5f5f5;">
  <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <h1 style="margin: 0 0 1rem 0; font-size: 1.25rem; color: #333;">${escapeHtml(title)}</h1>
    <table style="width: 100%; border-collapse: collapse;">
      ${productRows}
    </table>
    <p style="margin: 1rem 0 0 0; font-size: 0.8rem; color: #888;">Tracker – alertas de ofertas</p>
  </div>
</body>
</html>`;
}

/**
 * Envía un email de alerta con uno o varios matches.
 *
 * @param to - Dirección de destino
 * @param matches - Lista de matches (producto + opcionalmente confidenceScore)
 * @param config - Config SMTP opcional (si no se pasa, se usa env)
 * @returns Resultado con success, messageId o error
 */
export async function sendAlertEmail(
  to: string,
  matches: MatchItem[],
  config?: SmtpConfig
): Promise<SendAlertResult> {
  if (matches.length === 0) {
    const msg = "sendAlertEmail: no hay matches para enviar";
    console.warn(LOG_PREFIX, msg);
    return { success: false, error: msg };
  }

  const cfg = config ?? getSmtpConfigFromEnv();
  const transporter = getTransporter(cfg);
  const count = matches.length;
  const subject =
    count === 1
      ? `Tracker: ${matches[0].product.name}`
      : `Tracker: ${count} productos que coinciden con tu búsqueda`;

  const html = buildAlertHtml(matches);

  try {
    const info = await transporter.sendMail({
      from: cfg.from,
      to,
      subject,
      html,
    });

    console.log(LOG_PREFIX, "Email enviado", {
      to,
      subject,
      matchCount: count,
      messageId: info.messageId,
    });

    return { success: true, messageId: info.messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(LOG_PREFIX, "Error enviando email", { to, matchCount: count, error: message });
    return { success: false, error: message };
  }
}

/**
 * Resetea el transporter en caché (útil en tests o al cambiar config).
 */
export function resetTransporter(): void {
  cachedTransporter = null;
}
