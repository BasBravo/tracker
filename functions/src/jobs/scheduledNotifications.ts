/**
 * Job programado: envío de notificaciones por email.
 * Agrupa matches no notificados por tracking/email, envía un email por grupo, marca como notificado.
 */

import {
  getTrackingById,
  initializeFirebaseAdmin,
} from "../services/trackingRepository";
import { getUnnotifiedMatches, markManyAsNotified } from "../services/matchRepository";
import { sendAlertEmail } from "../services/emailService";

const MAX_EMAILS_PER_RUN = 50;
const LOG_CONTEXT = "scheduledNotifications";

function log(event: string, data: Record<string, unknown>): void {
  console.log(JSON.stringify({ context: LOG_CONTEXT, event, ...data }));
}

function logError(event: string, data: Record<string, unknown>): void {
  console.error(JSON.stringify({ context: LOG_CONTEXT, event, level: "error", ...data }));
}

export async function runScheduledNotifications(): Promise<void> {
  initializeFirebaseAdmin();
  const runId = Date.now();

  log("run_started", { runId, maxEmails: MAX_EMAILS_PER_RUN });

  const matches = await getUnnotifiedMatches({ limit: 1000 });
  const byTracking = new Map<string, Array<(typeof matches)[0]>>();
  for (const m of matches) {
    const list = byTracking.get(m.trackingId) ?? [];
    list.push(m);
    byTracking.set(m.trackingId, list);
  }

  const trackingIds = Array.from(byTracking.keys()).slice(0, MAX_EMAILS_PER_RUN);
  let emailsSent = 0;
  let emailsFailed = 0;
  let totalMarked = 0;

  for (const trackingId of trackingIds) {
    const group = byTracking.get(trackingId)!;
    const tracking = await getTrackingById(trackingId);
    if (!tracking) {
      logError("tracking_not_found", { runId, trackingId });
      continue;
    }
    const to = tracking.email;
    const items = group.map((m) => ({ product: m.product, confidenceScore: m.confidenceScore }));
    const result = await sendAlertEmail(to, items);
    if (result.success) {
      await markManyAsNotified(group.map((m) => m.id));
      totalMarked += group.length;
      emailsSent++;
      log("email_sent", {
        runId,
        trackingId,
        to,
        matchCount: group.length,
        messageId: result.messageId,
      });
    } else {
      emailsFailed++;
      logError("email_failed", {
        runId,
        trackingId,
        to,
        matchCount: group.length,
        error: result.error,
      });
    }
  }

  log("run_finished", { runId, emailsSent, emailsFailed, totalMarked });
}
