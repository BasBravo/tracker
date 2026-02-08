/**
 * Punto de entrada de Firebase Functions.
 * Solo wiring: exporta funciones programadas y HTTP delegando en handlers y jobs.
 */

import * as functions from "firebase-functions";
import { withCors, handleCreateTracking } from "./handlers";
import { runScheduledTrackingCheck } from "./jobs/scheduledTrackingCheck";
import { runScheduledNotifications } from "./jobs/scheduledNotifications";

const region = functions.region("europe-west3");

// ─── Programadas ─────────────────────────────────────────────────────────────

export const scheduledTrackingCheck = region.pubsub
  .schedule("0 * * * *")
  .timeZone("Europe/Madrid")
  .onRun(runScheduledTrackingCheck);

export const scheduledNotifications = region.pubsub
  .schedule("*/30 * * * *")
  .timeZone("Europe/Madrid")
  .onRun(runScheduledNotifications);

// ─── HTTP ───────────────────────────────────────────────────────────────────

export const createTracking = region.https.onRequest(withCors(handleCreateTracking));

export const helloWorld = region.https.onRequest(
  (request: functions.https.Request, response: functions.Response) => {
    response.send("Hello from Firebase!");
  }
);
