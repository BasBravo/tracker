/**
 * Lista trackings en Firestore (proyecto según PROJECT_ID / .env).
 * Útil para comprobar que run-jobs ve los mismos datos.
 *
 * Uso: pnpm run build && node -r dotenv/config lib/scripts/listTrackings.js
 */

import { initializeFirebaseAdmin, listTrackings, getActivePendingCheck } from "../services/trackingRepository";

async function main(): Promise<void> {
  const projectId = process.env.PROJECT_ID ?? process.env.PROJECT_ID;
  console.log("Proyecto:", projectId ?? "(cuenta de servicio)");
  console.log("");

  initializeFirebaseAdmin();

  const all = await listTrackings();
  const active = await listTrackings({ activeOnly: true });
  const pending = await getActivePendingCheck(10);

  console.log("Total trackings:", all.length);
  console.log("Activos (active=true):", active.length);
  console.log("Pendientes de chequeo (para run-jobs):", pending.length);
  console.log("");

  if (all.length === 0) {
    console.log("No hay trackings en este proyecto. Crea uno con: pnpm test:canyon");
    return;
  }

  for (const t of all) {
    const raw = (t as { lastChecked?: { toDate?: () => Date } }).lastChecked;
    const last = raw && typeof raw.toDate === "function" ? raw.toDate().toISOString() : raw ? String(raw) : "nunca";
    console.log(`- ${t.id} | active=${t.active} | lastChecked=${last}`);
    console.log(`  url: ${t.url}`);
    const instr = (t as { instruction?: string }).instruction;
    if (instr) console.log(`  instruction: ${instr.slice(0, 80)}${instr.length > 80 ? "..." : ""}`);
    console.log(`  email: ${t.email} | frequency: ${t.frequency}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
