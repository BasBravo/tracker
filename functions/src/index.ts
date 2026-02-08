/**
 * Punto de entrada de Firebase Functions.
 * Solo wiring: exporta funciones programadas y HTTP delegando en handlers y jobs.
 */

import * as functions from "firebase-functions";
import { withCors, handleCreateTracking } from "./handlers";
import { runScheduledTrackingCheck } from "./jobs/scheduledTrackingCheck";
import { runScheduledNotifications } from "./jobs/scheduledNotifications";

// ─── Programadas ─────────────────────────────────────────────────────────────

export const scheduledTrackingCheck = functions.pubsub
  .schedule("0 * * * *")
  .timeZone("Europe/Madrid")
  .onRun(runScheduledTrackingCheck);

export const scheduledNotifications = functions.pubsub
  .schedule("*/30 * * * *")
  .timeZone("Europe/Madrid")
  .onRun(runScheduledNotifications);

// ─── HTTP ───────────────────────────────────────────────────────────────────

export const createTracking = functions.https.onRequest(withCors(handleCreateTracking));

export const helloWorld = functions.https.onRequest(
  (request: functions.https.Request, response: functions.Response) => {
    response.send("Hello from Firebase!");
  }
);
