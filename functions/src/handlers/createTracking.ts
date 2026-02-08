/**
 * Handler HTTP POST para crear un tracking.
 * Body: { url, criteria?, email, frequency?, active? }
 * Valida, persiste en Firestore y devuelve el ID. Códigos HTTP apropiados.
 */

import type * as functions from "firebase-functions";
import type { Criteria, TrackingFrequency } from "../types";
import { validateUrl, validateEmail, validateCriteria, validateTrackingFrequency } from "../utils/validators";
import { createTracking } from "../services/trackingRepository";
import { initializeFirebaseAdmin } from "../services/trackingRepository";

const LOG_CONTEXT = "createTracking";

function log(event: string, data: Record<string, unknown>): void {
  console.log(JSON.stringify({ context: LOG_CONTEXT, event, ...data }));
}

function logError(event: string, data: Record<string, unknown>): void {
  console.error(JSON.stringify({ context: LOG_CONTEXT, event, level: "error", ...data }));
}

function sendJson(res: functions.Response, status: number, body: object): void {
  res.status(status).set("Content-Type", "application/json").send(JSON.stringify(body));
}

/**
 * Handler: POST con body JSON { url, criteria?, email, frequency?, active? }.
 */
export async function handleCreateTracking(
  req: functions.https.Request,
  res: functions.Response
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method Not Allowed", allowed: "POST" });
    return;
  }

  let body: unknown;
  try {
    body = typeof req.body === "object" && req.body !== null ? req.body : {};
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const raw = body as Record<string, unknown>;

  const urlResult = validateUrl(raw.url);
  if (!urlResult.success) {
    const msg = urlResult.error?.message ?? "URL inválida";
    sendJson(res, 400, { error: "Validation failed", details: { url: msg } });
    return;
  }

  const emailResult = validateEmail(raw.email);
  if (!emailResult.success) {
    const msg = emailResult.error?.message ?? "Email inválido";
    sendJson(res, 400, { error: "Validation failed", details: { email: msg } });
    return;
  }

  const criteriaResult = validateCriteria(raw.criteria ?? {});
  if (!criteriaResult.success) {
    const msg = criteriaResult.error?.message ?? "Criteria inválidos";
    sendJson(res, 400, { error: "Validation failed", details: { criteria: msg } });
    return;
  }

  const frequency = raw.frequency != null ? validateTrackingFrequency(raw.frequency) : null;
  const frequencyValue: TrackingFrequency = frequency?.success ? frequency.data : "daily";
  const active = typeof raw.active === "boolean" ? raw.active : true;

  initializeFirebaseAdmin();

  try {
    const tracking = await createTracking({
      url: urlResult.data,
      email: emailResult.data,
      criteria: criteriaResult.data as Criteria,
      frequency: frequencyValue,
      active,
    });

    log("tracking_created", { trackingId: tracking.id });
    sendJson(res, 201, { id: tracking.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("create_failed", { error: message });
    sendJson(res, 500, { error: "Internal Server Error", message });
  }
}
