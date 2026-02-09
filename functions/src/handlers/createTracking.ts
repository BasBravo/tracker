/**
 * Handler HTTP POST para crear un tracking.
 * Body: { url, instruction, email, frequency?, active?, paginationLimit? }
 * La IA extrae criterios desde la instrucción; se persisten url, instruction, criteria, etc.
 */

import type * as functions from "firebase-functions";
import type { Criteria, TrackingFrequency } from "../types";
import {
  validateUrl,
  validateEmail,
  validateInstruction,
  validateTrackingFrequency,
  validatePaginationLimit,
} from "../utils/validators";
import { createTracking as createTrackingInDb, initializeFirebaseAdmin } from "../services/trackingRepository";
import { extractCriteriaFromInstruction } from "../services/aiExtractor";

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
 * Handler: POST con body JSON { url, instruction, email, frequency?, active?, paginationLimit? }.
 * La instrucción en lenguaje natural se convierte en criterios estructurados mediante IA.
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
    const msg = urlResult.error?.issues?.[0]?.message ?? "URL inválida";
    sendJson(res, 400, { error: "Validation failed", details: { url: msg } });
    return;
  }

  const instructionResult = validateInstruction(raw.instruction);
  if (!instructionResult.success) {
    const msg = instructionResult.error?.issues?.[0]?.message ?? "Instrucción inválida";
    sendJson(res, 400, { error: "Validation failed", details: { instruction: msg } });
    return;
  }

  const emailResult = validateEmail(raw.email);
  if (!emailResult.success) {
    const msg = emailResult.error?.issues?.[0]?.message ?? "Email inválido";
    sendJson(res, 400, { error: "Validation failed", details: { email: msg } });
    return;
  }

  const frequency = raw.frequency != null ? validateTrackingFrequency(raw.frequency) : null;
  const frequencyValue: TrackingFrequency = frequency?.success ? (frequency.data as TrackingFrequency) : "daily";
  const active = typeof raw.active === "boolean" ? raw.active : true;
  const paginationLimitResult = validatePaginationLimit(raw.paginationLimit);
  const paginationLimit = paginationLimitResult.success ? paginationLimitResult.data : 5;

  const url = urlResult.data as string;
  const instruction = instructionResult.data as string;
  const email = emailResult.data as string;

  const criteria: Criteria = await extractCriteriaFromInstruction(instruction, url);

  initializeFirebaseAdmin();

  try {
    const tracking = await createTrackingInDb({
      url,
      instruction,
      criteria,
      email,
      frequency: frequencyValue,
      active,
      paginationLimit,
    });

    log("tracking_created", { trackingId: tracking.id });
    sendJson(res, 201, { id: tracking.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("create_failed", { error: message });
    sendJson(res, 500, { error: "Internal Server Error", message });
  }
}
