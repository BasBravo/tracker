/**
 * Job programado: chequeo de trackings activos.
 * Descarga HTML, extrae productos (schema/heurística), aplica criterios, guarda matches, actualiza lastChecked.
 */

import * as admin from "firebase-admin";
import {
  getActivePendingCheck,
  updateLastChecked,
  initializeFirebaseAdmin,
} from "../services/trackingRepository";
import { fetchHtml, FetchHtmlError } from "../services/httpClient";
import { extractProductsFromHtml } from "../services/schemaExtractor";
import { extractWithFallback } from "../services/heuristicParser";
import { findMatches } from "../services/criteriaAnalyzer";
import { saveMatch } from "../services/matchRepository";

const TRACKINGS_PER_RUN = 10;
const LOG_CONTEXT = "scheduledTrackingCheck";

function log(event: string, data: Record<string, unknown>): void {
  console.log(JSON.stringify({ context: LOG_CONTEXT, event, ...data }));
}

function logError(event: string, data: Record<string, unknown>): void {
  console.error(JSON.stringify({ context: LOG_CONTEXT, event, level: "error", ...data }));
}

export async function runScheduledTrackingCheck(): Promise<void> {
  initializeFirebaseAdmin();
  const runId = Date.now();

  log("run_started", { runId, limit: TRACKINGS_PER_RUN });

  let processed = 0;
  let errors = 0;
  let totalMatches = 0;

  const pending = await getActivePendingCheck(TRACKINGS_PER_RUN);
  log("pending_fetched", { runId, count: pending.length });

  for (const tracking of pending) {
    const trackingId = tracking.id;
    const trackingUrl = tracking.url;

    try {
      log("tracking_start", { runId, trackingId, url: trackingUrl });

      const { html, finalUrl } = await fetchHtml(trackingUrl);
      const schemaProducts = extractProductsFromHtml(html, finalUrl);
      const products = extractWithFallback(html, finalUrl, schemaProducts);

      if (products.length === 0) {
        log("tracking_no_products", { runId, trackingId });
        await updateLastChecked(trackingId);
        processed++;
        continue;
      }

      const matches = findMatches(products, tracking.criteria);
      const now = admin.firestore.Timestamp.now();
      let saved = 0;
      for (const m of matches) {
        const savedId = await saveMatch({
          trackingId,
          product: m.product,
          confidenceScore: m.confidenceScore,
          detectedAt: now,
          notified: false,
        });
        if (savedId) saved++;
      }

      totalMatches += saved;
      log("tracking_done", {
        runId,
        trackingId,
        productsFound: products.length,
        matchesFound: matches.length,
        matchesSaved: saved,
      });

      await updateLastChecked(trackingId);
      processed++;
    } catch (err) {
      errors++;
      const message = err instanceof Error ? err.message : String(err);
      const isFetchError = err instanceof FetchHtmlError;
      logError("tracking_error", {
        runId,
        trackingId,
        error: message,
        fetchError: isFetchError,
      });
    }
  }

  log("run_finished", { runId, processed, errors, totalMatches });
}
