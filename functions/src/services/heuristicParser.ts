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
  "[class*='price']",
  "[class*='Price']",
  ".value",
  ".product-tile__price",
  ".productTile__price",
  "[data-testid*='price']",
  "[class*='PriceAmount']",
  "[class*='priceAmount']",
];

/** Selectores de nombre de producto. */
const NAME_SELECTORS = [
  "[itemprop='name']",
  "h1",
  "h2",
  "h3",
  ".product-name",
  ".product-title",
  ".product__title",
  ".product-name__title",
  "[data-product-name]",
  "[class*='productName']",
  "[class*='product-title']",
  ".product-tile__title",
  ".productTile__title",
  "[data-testid*='title']",
  "[class*='Title']",
  "[class*='productName']",
  "span[class*='name']",
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
  ".tile",
  ".productTile",
  ".product-tile",
  "[data-pid]",
  "[data-product-id]",
  ".product-grid__item",
  ".product-grid-item",
  ".product-list-item",
  "li[class*='product']",
  "article[class*='tile']",
  "[class*='ProductTile']",
  "[class*='product-tile']",
  "article[class*='card']",
  "[class*='Card']",
  "[data-testid*='product']",
  "[data-testid*='card']",
  "article",
  "a[href*='/p/']",
  "a[href*='/product']",
  "[class*='OfferCard']",
  "[class*='offer-card']",
];

/**
 * Normaliza string de precio a número. Soporta formato europeo (1.799 = 1799) y decimal (29,99).
 */
function normalizePriceFromString(value: string): number | null {
  const cleaned = value.replace(PRICE_CLEAN_REGEX, "").trim();
  if (!cleaned) return null;
  const parts = cleaned.split(DECIMAL_SEP);
  let numStr: string;
  if (parts.length > 1) {
    const decimals = parts.pop()!;
    const rest = parts.join("").replace(/\s/g, "");
    if (decimals.length === 2) {
      numStr = rest + "." + decimals;
    } else if (decimals.length === 3 && rest.length <= 4) {
      numStr = rest + decimals;
    } else {
      numStr = rest + "." + decimals;
    }
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

/** Patrones para extraer una sola talla (disponibilidad exclusiva en esa talla). */
const SIZE_SINGLE_REGEXES = [
  /Disponible para comprar en\s+([A-Z0-9]+)/i,
  /Solo disponible en talla\s+([A-Z0-9]+)(?:\s|$)/i,
];

/** Patrón para listas de tallas: "talla L | XL", "S, M, L, XL", "Selecciona talla S  M  L  XL". */
const SIZE_LIST_REGEX = /(?:talla|size|talle|cuadro)\s*[:\s]*([A-Z0-9]+(?:\s*[\|,\/]\s*[A-Z0-9]+)+)/gi;
const SIZE_TOKEN_REGEX = /\b(3XS|2XS|XS|S|M|L|XL|2XL|\d{2})\b/g;

/**
 * Extrae todas las tallas disponibles en el texto de la card.
 * - Si hay "Disponible para comprar en L" -> solo L disponible.
 * - Si hay "talla L | XL" o "S, M, L, XL" -> devuelve ["L","XL"] o ["S","M","L","XL"].
 * Así el criterio puede comprobar si la talla pedida está en la lista.
 */
function getAllSizesFromAvailabilityText(cardText: string): string[] {
  const normalized = cardText.replace(/\s+/g, " ").trim();

  for (const re of SIZE_SINGLE_REGEXES) {
    const m = normalized.match(re);
    if (m && m[1]) {
      const size = m[1].trim();
      if (size.length <= 4) return [size];
    }
  }

  const listMatch = normalized.matchAll(SIZE_LIST_REGEX);
  for (const m of listMatch) {
    const block = m[1].trim();
    const parts = block.split(/[\|,\/\s]+/).map((s) => s.trim()).filter((s) => s.length > 0 && s.length <= 4);
    if (parts.length > 0) return [...new Set(parts)];
  }

  const tokens: string[] = [];
  let tokenMatch: RegExpExecArray | null;
  const tokenRe = new RegExp(SIZE_TOKEN_REGEX.source, "gi");
  const sizeContext = /(?:talla|size|selecciona|disponible|cuadro)/i;
  if (sizeContext.test(normalized)) {
    while ((tokenMatch = tokenRe.exec(normalized)) !== null) {
      tokens.push(tokenMatch[1].trim());
    }
    if (tokens.length > 0) return [...new Set(tokens)];
  }

  return [];
}

/**
 * Extrae talla(s) desde el texto de la card y las devuelve como string único.
 * Una talla -> "L". Varias -> "M,L,XL" para que el criterio pueda comprobar si la pedida está incluida.
 */
function getSizeFromAvailabilityText(cardText: string): string | undefined {
  const sizes = getAllSizesFromAvailabilityText(cardText);
  if (sizes.length === 0) return undefined;
  return sizes.join(",");
}

/** Regex para encontrar números que parecen precios (ej. 1.799 o 2.499,99). */
const PRICE_NUMBER_REGEX = /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?)/g;

/**
 * Números que van seguidos de " €" o " EUR" (precio explícito). Excluye "X €/mes".
 * Evita capturar códigos de modelo (ej. "RX810") o otros dígitos que no son precio.
 */
const PRICE_WITH_CURRENCY_REGEX =
  /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?)\s*(?:€|EUR)(?!\s*\/\s*mes)/gi;

/** Precio mínimo razonable para no confundir con cantidades o tallas (ej. "1" en "Card 1"). */
const MIN_REASONABLE_PRICE = 5;
/** Precio mínimo para considerar "precio principal" (evita cuotas "desde X €/mes" y números de modelo). */
const MIN_MAIN_PRICE_EUR = 100;

/**
 * Comprueba si el número en cardText en (startIndex, startIndex+matchLen) está en contexto de cuota mensual.
 */
function isMonthlyPaymentContext(cardText: string, startIndex: number, matchLen: number): boolean {
  const after = cardText.slice(startIndex + matchLen, startIndex + matchLen + 20);
  const before = cardText.slice(Math.max(0, startIndex - 12), startIndex);
  if (/\s*€\s*\/\s*mes/i.test(after) || /\s*€\s*\/\s*month/i.test(after)) return true;
  if (/desde\s+$/i.test(before)) return true;
  return false;
}

/**
 * Comprueba si el número en numberStartIndex está en contexto de "ahorro" (ej. "Ahorra hasta 1.300 €").
 * Esos valores no son el precio del producto y no deben usarse.
 */
function isSavingsContext(cardText: string, numberStartIndex: number): boolean {
  const before = cardText.slice(Math.max(0, numberStartIndex - 35), numberStartIndex);
  return /(?:ahorra\s+hasta\s*|ahorras\s*|ahorra\s*|save\s*|savings?\s*|ahorro\s*|descuento\s*|discount\s*|you\s+save\s*)$/i.test(
    before.trim()
  );
}

/**
 * Extrae precios que aparecen en contexto explícito de moneda: "2.499 €", "Desde 4.199 €", etc.
 * Excluye: "X €/mes", "Ahorra hasta X €", "Ahorras X €", "Save X €". No modifica el valor extraído.
 */
function getPricesFromExplicitCurrencyContext(cardText: string): number[] {
  const numbers: number[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(PRICE_WITH_CURRENCY_REGEX.source, "gi");
  while ((m = re.exec(cardText)) !== null) {
    if (isSavingsContext(cardText, m.index)) continue;
    const parsed = normalizePriceFromString(m[1]);
    if (parsed != null && parsed >= MIN_REASONABLE_PRICE && parsed < 100_000) {
      numbers.push(parsed);
    }
  }
  return numbers;
}

/**
 * Extrae todos los números que parecen precios en el texto de la card.
 * Excluye cuotas mensuales (ej. "30 €/mes") y devuelve candidatos para elegir el precio principal.
 */
function getAllPricesFromCardText(cardText: string): number[] {
  const numbers: number[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(PRICE_NUMBER_REGEX.source, "g");
  while ((m = re.exec(cardText)) !== null) {
    if (isMonthlyPaymentContext(cardText, m.index, m[1].length)) continue;
    const parsed = normalizePriceFromString(m[1]);
    if (
      parsed != null &&
      parsed >= MIN_REASONABLE_PRICE &&
      parsed < 100_000
    ) {
      numbers.push(parsed);
    }
  }
  return numbers;
}

/**
 * Devuelve el precio principal de la card.
 * 1) Prioriza números en contexto explícito de precio ("X.XXX €"), para no confundir con códigos (RX810).
 * 2) Entre esos, usa el mínimo con valor >= MIN_MAIN_PRICE_EUR si hay (precio de oferta, no tachado).
 * 3) Si no hay ningún precio explícito con €/EUR, hace fallback a todos los números de la card (comportamiento anterior).
 */
function getMainPriceFromCardText(cardText: string): number | null {
  const explicitPrices = getPricesFromExplicitCurrencyContext(cardText);
  const candidates =
    explicitPrices.length > 0 ? explicitPrices : getAllPricesFromCardText(cardText);
  if (candidates.length === 0) return null;
  const mainPrices = candidates.filter((p) => p >= MIN_MAIN_PRICE_EUR);
  const toUse = mainPrices.length > 0 ? mainPrices : candidates;
  return Math.min(...toUse);
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
  const cardText = card.text() ?? "";

  let price: number | null = getMainPriceFromCardText(cardText);
  if (price == null) {
    const priceRaw = firstText($, PRICE_SELECTORS, card);
    price = priceRaw != null ? normalizePriceFromString(priceRaw) : null;
  }
  if (price == null || price <= 0) return null;

  let size = firstText($, SIZE_SELECTORS, card)?.trim();
  if (!size) {
    const sizeFromAvail = getSizeFromAvailabilityText(cardText);
    if (sizeFromAvail) size = sizeFromAvail;
  }

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
