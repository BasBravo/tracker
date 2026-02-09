/**
 * Verificación de matches en la página individual del producto.
 * Solo se analizan URLs con match >= 70%. Si no se puede acceder a la URL se mantiene el match;
 * si se confirma que no cumple criterios en la página de detalle, se descarta.
 */

import type { Product, Criteria } from "../types";
import type { CriteriaMatch } from "./criteriaAnalyzer";
import { getMatchScore, MIN_MATCH_SCORE, isRequestedSizeAvailable } from "./criteriaAnalyzer";
import { extractAvailabilityFromProductPage } from "./availabilityExtractor";
import { fetchHtml, FetchHtmlError } from "./httpClient";
import {
  extractProductsFromHtml,
  extractProductsFromEmbeddedJson,
} from "./schemaExtractor";
import { extractWithFallback } from "./heuristicParser";
import {
  isAiExtractionAvailable,
  extractProductsWithAi,
} from "./aiExtractor";

const LOG_PREFIX = "productPageVerifier";

/** Máximo de URLs de producto a verificar por tracking (evita timeouts). */
export const MAX_PRODUCT_PAGES_TO_VERIFY = 15;

/** Pausa entre peticiones a páginas de producto (ms). */
const DELAY_BETWEEN_FETCHES_MS = 800;

/**
 * Normaliza una URL para comparación (sin hash, sin trailing slash).
 */
function normalizeUrlForCompare(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    let path = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.origin}${path}${u.search}`;
  } catch {
    return url;
  }
}

/**
 * Extrae productos del HTML de una página (listado o detalle).
 * Misma pipeline que el job: schema → embedded → heurística → IA si disponible.
 */
async function extractProductsFromProductPage(
  html: string,
  pageUrl: string
): Promise<Array<Product & { confidenceScore: number }>> {
  const schemaProducts = extractProductsFromHtml(html, pageUrl);
  let embedded: ReturnType<typeof extractProductsFromEmbeddedJson> = [];
  if (schemaProducts.length === 0) {
    embedded = extractProductsFromEmbeddedJson(html, pageUrl);
  }
  const initial = schemaProducts.length > 0 ? schemaProducts : embedded;
  let products = extractWithFallback(html, pageUrl, initial);

  if (products.length === 0 && isAiExtractionAvailable()) {
    try {
      products = await extractProductsWithAi(html, pageUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(LOG_PREFIX, "IA fallback en página de producto falló", {
        pageUrl,
        error: message,
      });
    }
  }

  return products;
}

/** Resultado de verificar un match en la página del producto. */
export interface VerifyResult {
  /** Si se debe mantener el match (no accesible, o accesible y cumple criterios). */
  keep: boolean;
  /** Producto a guardar: el extraído de la página de detalle si hay y se mantiene; si no, el original. */
  product: Product;
  /** Score de confianza a guardar (del detalle si hay; si no, el original). */
  confidenceScore: number;
  /** Motivo para logging. */
  reason:
    | "fetch_failed"
    | "no_product_extracted"
    | "confirmed_match"
    | "discarded_no_match"
    | "discarded_size_not_available";
}

/**
 * Verifica un match accediendo a la URL del producto y re-evaluando con los criterios.
 * - Si no se puede acceder a la URL → se mantiene el match (producto y score originales).
 * - Si se extrae producto de la página y no cumple criterios (score < 70%) → se descarta.
 * - Si cumple o no se pudo extraer producto → se mantiene (usando datos del detalle si hay).
 *
 * @param match - Match candidato (ya con score >= 70% desde listado)
 * @param criteria - Criterios del tracking
 * @returns Resultado con keep, product, confidenceScore y reason
 */
export async function verifyMatchOnProductPage(
  match: CriteriaMatch,
  criteria: Criteria
): Promise<VerifyResult> {
  const productUrl = match.product.url?.trim();
  if (!productUrl) {
    return {
      keep: true,
      product: match.product,
      confidenceScore: match.confidenceScore,
      reason: "fetch_failed",
    };
  }

  let html: string;
  let finalUrl: string;
  try {
    const result = await fetchHtml(productUrl);
    html = result.html;
    finalUrl = result.finalUrl;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isFetchError = err instanceof FetchHtmlError;
    if (isFetchError || message) {
      console.warn(LOG_PREFIX, "No se pudo acceder a la URL del producto; se mantiene el match", {
        url: productUrl,
        error: message,
      });
    }
    return {
      keep: true,
      product: match.product,
      confidenceScore: match.confidenceScore,
      reason: "fetch_failed",
    };
  }

  const products = await extractProductsFromProductPage(html, finalUrl);
  const wantedNormalized = normalizeUrlForCompare(productUrl);

  let chosen: (Product & { confidenceScore: number }) | null = null;
  for (const p of products) {
    const pUrl = p.url?.trim();
    if (pUrl && normalizeUrlForCompare(pUrl) === wantedNormalized) {
      chosen = p;
      break;
    }
  }
  if (!chosen && products.length > 0) {
    chosen = products[0];
  }

  if (!chosen) {
    return {
      keep: true,
      product: match.product,
      confidenceScore: match.confidenceScore,
      reason: "no_product_extracted",
    };
  }

  const availability = extractAvailabilityFromProductPage(html, finalUrl);
  if (criteria.size?.trim() && availability.availableSizes.length > 0) {
    const wantedSize = criteria.size.trim();
    if (!isRequestedSizeAvailable(wantedSize, availability.availableSizes)) {
      return {
        keep: false,
        product: chosen,
        confidenceScore: 0,
        reason: "discarded_size_not_available",
      };
    }
  }

  const score = getMatchScore(chosen, criteria);
  if (score >= MIN_MATCH_SCORE) {
    return {
      keep: true,
      product: chosen,
      confidenceScore: Math.round(score * 100) / 100,
      reason: "confirmed_match",
    };
  }

  return {
    keep: false,
    product: chosen,
    confidenceScore: score,
    reason: "discarded_no_match",
  };
}

/**
 * Verifica en lote los matches con score >= minScore, con límite y pausa entre peticiones.
 * Solo se analizan las URLs con posibilidad de match >= minScore (p. ej. 0.7).
 *
 * @param matches - Matches candidatos (ya filtrados por findMatches con minScore)
 * @param criteria - Criterios del tracking
 * @param options - maxToVerify, delayMs, log callback
 * @returns Solo los matches que se deben mantener (keep === true)
 */
export async function verifyMatchesOnProductPages(
  matches: CriteriaMatch[],
  criteria: Criteria,
  options: {
    maxToVerify?: number;
    delayMs?: number;
    log?: (event: string, data: Record<string, unknown>) => void;
  } = {}
): Promise<CriteriaMatch[]> {
  const { maxToVerify = MAX_PRODUCT_PAGES_TO_VERIFY, delayMs = DELAY_BETWEEN_FETCHES_MS, log } = options;
  const toProcess = matches.slice(0, maxToVerify);
  if (toProcess.length === 0) return matches;

  const results: CriteriaMatch[] = [];
  let verified = 0;
  let discarded = 0;
  let keptWithoutVerify = 0;

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    if (i >= maxToVerify) {
      results.push(match);
      keptWithoutVerify++;
      continue;
    }

    if (i > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }

    const vr = await verifyMatchOnProductPage(match, criteria);
    if (vr.keep) {
      results.push({ product: vr.product, confidenceScore: vr.confidenceScore });
      if (vr.reason === "confirmed_match") verified++;
      else if (vr.reason === "no_product_extracted" || vr.reason === "fetch_failed") keptWithoutVerify++;
    } else {
      discarded++;
      log?.("product_page_discarded", {
        url: match.product.url,
        reason: vr.reason,
        score: vr.confidenceScore,
      });
    }
  }

  log?.("product_page_verification_done", {
    total: matches.length,
    verified,
    discarded,
    keptWithoutVerification: keptWithoutVerify,
    keptTotal: results.length,
  });

  return results;
}
