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
import {
  fetchHtml,
  fetchHtmlHeadless,
  FetchHtmlError,
  FETCH_ERROR_ANTIBOT,
  isHeadlessFetchAvailable,
} from "../services/httpClient";
import {
  extractProductsFromHtml,
  extractProductsFromEmbeddedJson,
} from "../services/schemaExtractor";
import { extractWithFallback } from "../services/heuristicParser";
import { getNextPageUrl } from "../services/paginationHelper";
import {
  isAiExtractionAvailable,
  extractProductsWithAi,
  filterProductsByType,
  isRelevanceFilterAvailable,
  filterMatchesByRelevance,
} from "../services/aiExtractor";
import { findMatches } from "../services/criteriaAnalyzer";
import { verifyMatchesOnProductPages } from "../services/productPageVerifier";
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

  const projectId = process.env.PROJECT_ID;
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
        let html: string;
        let finalUrl: string;
        try {
          const result = await fetchHtml(currentUrl);
          html = result.html;
          finalUrl = result.finalUrl;
        } catch (fetchErr) {
          if (
            fetchErr instanceof FetchHtmlError &&
            fetchErr.code === FETCH_ERROR_ANTIBOT &&
            isHeadlessFetchAvailable()
          ) {
            const headlessUrl = process.env.HEADLESS_FETCH_URL!.trim();
            log("tracking_headless_fallback", { runId, trackingId, page: pagesFetched + 1 });
            const result = await fetchHtmlHeadless(currentUrl, headlessUrl);
            html = result.html;
            finalUrl = result.finalUrl;
          } else {
            throw fetchErr;
          }
        }
        pagesFetched++;

        const schemaProducts = extractProductsFromHtml(html, finalUrl);
        let embeddedProducts: ReturnType<typeof extractProductsFromEmbeddedJson> = [];
        if (schemaProducts.length === 0) {
          embeddedProducts = extractProductsFromEmbeddedJson(html, finalUrl);
          if (embeddedProducts.length > 0) {
            log("tracking_embedded_json_used", { runId, trackingId, page: pagesFetched, count: embeddedProducts.length });
          }
        }
        const initialProducts = schemaProducts.length > 0 ? schemaProducts : embeddedProducts;
        let pageProducts = extractWithFallback(html, finalUrl, initialProducts);

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

      let productsToMatch = allProducts;
      const productTypeHint = tracking.criteria?.productTypeHint?.trim();
      if (productTypeHint) {
        log("tracking_type_filter_start", { runId, trackingId, productTypeHint, totalProducts: allProducts.length });
        productsToMatch = await filterProductsByType(
          allProducts,
          productTypeHint,
          tracking.instruction
        );
        log("tracking_type_filter_done", {
          runId,
          trackingId,
          afterFilter: productsToMatch.length,
        });
      }

      let matches = findMatches(productsToMatch, tracking.criteria);
      if (matches.length > 0 && isRelevanceFilterAvailable()) {
        log("tracking_relevance_filter_start", { runId, trackingId, matchesBefore: matches.length });
        matches = await filterMatchesByRelevance(matches, tracking.criteria, tracking.instruction);
        log("tracking_relevance_filter_done", { runId, trackingId, matchesAfter: matches.length });
      }
      if (matches.length > 0) {
        log("tracking_product_page_verification_start", { runId, trackingId, matchesBefore: matches.length });
        matches = await verifyMatchesOnProductPages(matches, tracking.criteria, {
          log: (event, data) => log(event, { runId, trackingId, ...data }),
        });
        log("tracking_product_page_verification_done", { runId, trackingId, matchesAfter: matches.length });
      }
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
        productsAfterTypeFilter: productTypeHint ? productsToMatch.length : undefined,
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
      const isAntibot = isFetchError && (err as FetchHtmlError).code === FETCH_ERROR_ANTIBOT;
      logError("tracking_error", {
        runId,
        trackingId,
        error: message,
        fetchError: isFetchError,
        antibotChallenge: isAntibot,
      });
      if (isAntibot) {
        log("tracking_antibot_hint", {
          runId,
          trackingId,
          hint: isHeadlessFetchAvailable()
            ? "Headless está configurado pero falló o no se intentó en esta petición."
            : "Configura HEADLESS_FETCH_URL (servicio con Puppeteer/Playwright) para sitios anti-bot. Ver README.",
        });
      }
    }
  }

  log("run_finished", { runId, processed, errors, totalMatches });
}
