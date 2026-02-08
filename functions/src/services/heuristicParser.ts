/**
 * Parser heurístico como fallback cuando schema.org no devuelve resultados.
 * Usa selectores CSS comunes para precio, nombre, talla y color.
 * Confidence score en rango 0.5–0.7.
 */

import * as cheerio from "cheerio";
import type { Product } from "../types";

const DEFAULT_CURRENCY = "EUR";
const PRICE_CLEAN_REGEX = /[^\d.,\-]/g;
const DECIMAL_SEP = /[,.]/;

/** Score mínimo y máximo para resultados heurísticos (fallback). */
const HEURISTIC_SCORE_MIN = 0.5;
const HEURISTIC_SCORE_MAX = 0.7;

/** Selectores comunes de precio (orden de prioridad). */
const PRICE_SELECTORS = [
  "[itemprop='price']",
  ".price",
  ".precio",
  ".product-price",
  ".current-price",
  ".sale-price",
  ".amount",
  "[data-price]",
  ".price-value",
];

/** Selectores de nombre de producto. */
const NAME_SELECTORS = [
  "[itemprop='name']",
  "h1",
  ".product-name",
  ".product-title",
  ".product__title",
  ".product-name__title",
  "[data-product-name]",
];

/** Selectores de talla. */
const SIZE_SELECTORS = [
  "[itemprop='size']",
  ".size",
  ".talla",
  ".talle",
  "[data-size]",
  ".variant-size",
  ".product-size",
  "select[name*='size'] option[selected]",
  ".selected-size",
];

/** Selectores de color. */
const COLOR_SELECTORS = [
  "[itemprop='color']",
  ".color",
  ".colour",
  "[data-color]",
  ".variant-color",
  ".product-color",
  ".selected-color",
];

/** Selectores de imagen principal. */
const IMAGE_SELECTORS = [
  "[itemprop='image']",
  ".product-image img",
  ".product__image img",
  "img.main-image",
  ".gallery img",
];

/** Contenedores de producto en listados (cada uno puede tener nombre + precio). */
const PRODUCT_CARD_SELECTORS = [
  ".product-item",
  ".product-card",
  ".product-tile",
  ".product",
  ".product__card",
  "article.product",
  "[data-product]",
];

function normalizePriceFromString(value: string): number | null {
  const cleaned = value.replace(PRICE_CLEAN_REGEX, "").trim();
  if (!cleaned) return null;
  const parts = cleaned.split(DECIMAL_SEP);
  let numStr: string;
  if (parts.length > 1) {
    const decimals = parts.pop()!;
    numStr = parts.join("").replace(/\s/g, "") + "." + decimals;
  } else {
    numStr = cleaned.replace(/\s/g, "");
  }
  const num = parseFloat(numStr);
  return Number.isNaN(num) || num < 0 ? null : num;
}

function firstText($: cheerio.CheerioAPI, selectors: string[], root: cheerio.Cheerio<any>): string | undefined {
  const el = root.length ? root : $.root();
  for (const sel of selectors) {
    try {
      const node = el.find(sel).first();
      const content = node.attr("content") ?? node.text();
      const text = (typeof content === "string" ? content : "").trim();
      if (text) return text;
    } catch {
      // selector inválido o sin resultados
    }
  }
  return undefined;
}

function firstAttr($: cheerio.CheerioAPI, selectors: string[], attr: string, root: cheerio.Cheerio<any>): string | undefined {
  const el = root.length ? root : $.root();
  for (const sel of selectors) {
    try {
      const node = el.find(sel).first();
      const val = node.attr(attr);
      if (typeof val === "string" && val.trim()) return val.trim();
    } catch {
      //
    }
  }
  return undefined;
}

/**
 * Extrae productos desde una página usando solo heurísticas (Cheerio).
 * Solo debe usarse cuando la extracción por schema.org no devuelve resultados.
 *
 * @param html - HTML de la página
 * @param pageUrl - URL de la página
 * @returns Productos con confidence score en [0.5, 0.7]
 */
export function extractProductsHeuristic(html: string, pageUrl: string): Array<Product & { confidenceScore: number }> {
  const $ = cheerio.load(html);
  const results: Array<Product & { confidenceScore: number }> = [];

  const cards = findProductCards($);
  if (cards.length > 0) {
    for (const card of cards) {
      const product = extractProductFromCard($, card, pageUrl);
      if (product) results.push(product);
    }
  } else {
    const product = extractSingleProduct($, pageUrl);
    if (product) results.push(product);
  }

  return results;
}

function findProductCards($: cheerio.CheerioAPI): cheerio.Cheerio<any>[] {
  const out: cheerio.Cheerio<any>[] = [];
  for (const sel of PRODUCT_CARD_SELECTORS) {
    const nodes = $(sel);
    if (nodes.length > 0) {
      nodes.each((_, el) => {
        out.push($(el));
      });
      if (out.length > 0) return out;
    }
  }
  return out;
}

function extractProductFromCard(
  $: cheerio.CheerioAPI,
  card: cheerio.Cheerio<any>,
  pageUrl: string
): (Product & { confidenceScore: number }) | null {
  const name = firstText($, NAME_SELECTORS, card);
  const priceRaw = firstText($, PRICE_SELECTORS, card);
  const price = priceRaw != null ? normalizePriceFromString(priceRaw) : null;
  if (price == null) return null;

  const size = firstText($, SIZE_SELECTORS, card);
  const color = firstText($, COLOR_SELECTORS, card);
  const image = firstAttr($, IMAGE_SELECTORS, "src", card);
  const link = card.find("a[href]").first().attr("href");
  const url = link ? resolveUrl(link, pageUrl) : pageUrl;

  const product: Product = {
    name: name?.trim() ?? "Producto",
    price,
    currency: DEFAULT_CURRENCY,
    url,
    ...(size?.trim() && { size: size.trim() }),
    ...(color?.trim() && { color: color.trim() }),
    ...(image && { image: resolveUrl(image, pageUrl) }),
  };

  const confidenceScore = clampHeuristicScore(computeHeuristicScore(product));
  return { ...product, confidenceScore };
}

function extractSingleProduct(
  $: cheerio.CheerioAPI,
  pageUrl: string
): (Product & { confidenceScore: number }) | null {
  const name = firstText($, NAME_SELECTORS, $.root());
  const priceRaw = firstText($, PRICE_SELECTORS, $.root());
  const price = priceRaw != null ? normalizePriceFromString(priceRaw) : null;
  if (price == null) return null;

  const size = firstText($, SIZE_SELECTORS, $.root());
  const color = firstText($, COLOR_SELECTORS, $.root());
  const image = firstAttr($, IMAGE_SELECTORS, "src", $.root());

  const product: Product = {
    name: name?.trim() ?? "Producto",
    price,
    currency: DEFAULT_CURRENCY,
    url: pageUrl,
    ...(size?.trim() && { size: size.trim() }),
    ...(color?.trim() && { color: color.trim() }),
    ...(image && { image: resolveUrl(image, pageUrl) }),
  };

  const confidenceScore = clampHeuristicScore(computeHeuristicScore(product));
  return { ...product, confidenceScore };
}

/**
 * Score heurístico según campos presentes (luego se clampa a [0.5, 0.7]).
 */
function computeHeuristicScore(product: Product): number {
  let score = 0.5;
  if (product.name?.trim()) score += 0.05;
  if (typeof product.price === "number" && product.price >= 0) score += 0.05;
  if (product.size?.trim()) score += 0.05;
  if (product.color?.trim()) score += 0.05;
  if (product.image?.trim()) score += 0.05;
  return Math.round(score * 100) / 100;
}

function clampHeuristicScore(score: number): number {
  const clamped = Math.max(HEURISTIC_SCORE_MIN, Math.min(HEURISTIC_SCORE_MAX, score));
  return Math.round(clamped * 100) / 100;
}

function resolveUrl(href: string, base: string): string {
  const s = href.trim();
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  try {
    return new URL(s, base).href;
  } catch {
    return base;
  }
}

/**
 * Extrae productos con schema.org y, si no hay resultados, usa el parser heurístico.
 *
 * @param html - HTML de la página
 * @param pageUrl - URL de la página
 * @param schemaProducts - Resultado previo de extractProductsFromHtml (si [], se usa heurística)
 * @returns Productos (schema o heurística) con confidence score
 */
export function extractWithFallback(
  html: string,
  pageUrl: string,
  schemaProducts: Array<{ confidenceScore: number }>
): Array<Product & { confidenceScore: number }> {
  if (schemaProducts.length > 0) {
    return schemaProducts as Array<Product & { confidenceScore: number }>;
  }
  return extractProductsHeuristic(html, pageUrl);
}
