/**
 * Ejecuta los dos jobs programados en local: chequeo de trackings y envío de notificaciones.
 * Útil para forzar una pasada sin esperar al cron (cada hora / cada 30 min).
 *
 * Requisitos:
 *   - GOOGLE_APPLICATION_CREDENTIALS apuntando a una cuenta de servicio con acceso a Firestore.
 *   - Variables de SMTP (y opcionalmente Gemini) en el entorno, p. ej. cargando .env.
 *
 * Uso:
 *   pnpm run build && node lib/scripts/runScheduledJobs.js
 *   O con env desde .env: node -r dotenv/config lib/scripts/runScheduledJobs.js  # si usas dotenv
 */

import { runScheduledTrackingCheck } from "../jobs/scheduledTrackingCheck";
import { runScheduledNotifications } from "../jobs/scheduledNotifications";

async function main(): Promise<void> {
  console.log("Running scheduledTrackingCheck...");
  await runScheduledTrackingCheck();
  console.log("Running scheduledNotifications...");
  await runScheduledNotifications();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
