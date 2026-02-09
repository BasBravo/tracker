/**
 * Job programado: chequeo de trackings activos.
 * Descarga HTML (con paginación si existe), extrae productos (schema/heurística/IA), aplica criterios, guarda matches.
 */

import * as admin from "firebase-admin";
import type { Product } from "../types";
import {
  getActivePendingCheck,
  updateLastChecked,
  initializeFirebaseAdmin,
} from "../services/trackingRepository";
import { fetchHtml, FetchHtmlError } from "../services/httpClient";
import { extractProductsFromHtml } from "../services/schemaExtractor";
import { extractWithFallback } from "../services/heuristicParser";
import { getNextPageUrl } from "../services/paginationHelper";
import {
  isAiExtractionAvailable,
  extractProductsWithAi,
} from "../services/aiExtractor";
import { findMatches } from "../services/criteriaAnalyzer";
import { saveMatch } from "../services/matchRepository";

const TRACKINGS_PER_RUN = 10;
const DEFAULT_PAGINATION_LIMIT = 5;
const LOG_CONTEXT = "scheduledTrackingCheck";

function log(event: string, data: Record<string, unknown>): void {
  console.log(JSON.stringify({ context: LOG_CONTEXT, event, ...data }));
}

function logError(event: string, data: Record<string, unknown>): void {
  console.error(JSON.stringify({ context: LOG_CONTEXT, event, level: "error", ...data }));
}

function mergeProductsDedupeByUrl(
  existing: Array<Product & { confidenceScore: number }>,
  incoming: Array<Product & { confidenceScore: number }>
): Array<Product & { confidenceScore: number }> {
  const byUrl = new Map<string, Product & { confidenceScore: number }>();
  for (const p of existing) byUrl.set(p.url, p);
  for (const p of incoming) {
    if (!byUrl.has(p.url)) byUrl.set(p.url, p);
  }
  return Array.from(byUrl.values());
}

export async function runScheduledTrackingCheck(): Promise<void> {
  initializeFirebaseAdmin();
  const runId = Date.now();

  log("run_started", { runId, limit: TRACKINGS_PER_RUN });

  let processed = 0;
  let errors = 0;
  let totalMatches = 0;

  const projectId = process.env.PROJECT_ID ?? process.env.PROJECT_ID;
  const forceCheck = process.env.FORCE_CHECK === "1";
  log("run_config", { runId, projectId: projectId ?? "(usa proyecto de la cuenta de servicio)", forceCheck });

  const pending = await getActivePendingCheck(TRACKINGS_PER_RUN, { force: forceCheck });
  log("pending_fetched", { runId, count: pending.length });
  if (pending.length === 0) {
    log("pending_empty_hint", {
      runId,
      hint: "No hay trackings activos pendientes de chequeo en este proyecto. Comprueba en Firebase Console (Firestore, colección 'trackings') que existan documentos con active=true y que PROJECT_ID en .env coincida con ese proyecto.",
    });
  }

  for (const tracking of pending) {
    const trackingId = tracking.id;
    const trackingUrl = tracking.url;
    const paginationLimit = tracking.paginationLimit ?? DEFAULT_PAGINATION_LIMIT;

    try {
      log("tracking_start", { runId, trackingId, url: trackingUrl, paginationLimit });

      let allProducts: Array<Product & { confidenceScore: number }> = [];
      let currentUrl: string = trackingUrl;
      let pagesFetched = 0;

      while (pagesFetched < paginationLimit) {
        const { html, finalUrl } = await fetchHtml(currentUrl);
        pagesFetched++;

        const schemaProducts = extractProductsFromHtml(html, finalUrl);
        let pageProducts = extractWithFallback(html, finalUrl, schemaProducts);

        if (pageProducts.length === 0 && isAiExtractionAvailable()) {
          log("tracking_ai_fallback", { runId, trackingId, page: pagesFetched });
          pageProducts = await extractProductsWithAi(html, finalUrl);
        }

        allProducts = mergeProductsDedupeByUrl(allProducts, pageProducts);

        if (pagesFetched === 1 && pageProducts.length === 0) {
          log("tracking_ai_skipped", {
            runId,
            trackingId,
            reason: "Schema y heurística no encontraron productos; IA no usada (configura GEMINI_API_KEY o VERTEX_AI_LOCATION en .env).",
          });
        }

        const nextUrl = getNextPageUrl(html, finalUrl);
        if (!nextUrl || nextUrl === currentUrl) break;
        currentUrl = nextUrl;
      }

      if (allProducts.length === 0) {
        log("tracking_no_products", {
          runId,
          trackingId,
          pagesFetched,
          hint: "Ninguna técnica extrajo productos. Para páginas con mucho JavaScript (p. ej. Canyon) configura GEMINI_API_KEY en .env.",
        });
        await updateLastChecked(trackingId);
        processed++;
        continue;
      }

      const matches = findMatches(allProducts, tracking.criteria);
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
        productsFound: allProducts.length,
        pagesFetched,
        matchesFound: matches.length,
        matchesSaved: saved,
      });
      if (matches.length > 0 && saved === 0) {
        log("tracking_matches_already_saved", {
          runId,
          trackingId,
          hint: "Todos los matches ya existían (mismo tracking + product.url). No se envían correos duplicados. Para recibir de nuevo: borra los documentos en Firestore colección 'matches' de este trackingId o crea un tracking nuevo.",
        });
      }

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
