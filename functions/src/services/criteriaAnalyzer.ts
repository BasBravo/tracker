/**
 * Análisis de productos frente a criterios de tracking.
 * Evalúa precio, talla y color (exacto o similar) y calcula confidence score.
 */

import type { Criteria, Product } from "../types";

/** Score mínimo para considerar un match (inclusive). */
export const MIN_MATCH_SCORE = 0.7;

/** Fallback de precio mínimo cuando productTypeHint es "bicicletas" y la IA no devolvió priceMin (trackings antiguos). */
const FALLBACK_PRICE_MIN_BICYCLES_EUR = 100;

/** Peso de cada criterio en el score final (deben sumar 1). */
const WEIGHT_PRICE = 0.4;
const WEIGHT_SIZE = 0.3;
const WEIGHT_COLOR = 0.3;

/** Equivalencias de tallas (clave normalizada -> variantes aceptadas). */
const SIZE_EQUIVALENTS: Record<string, string[]> = {
  xs: ["xs", "extra small", "34", "36"],
  s: ["s", "small", "36", "38"],
  m: ["m", "medium", "med", "38", "40"],
  l: ["l", "large", "42", "44"],
  xl: ["xl", "extra large", "44", "46"],
  xxl: ["xxl", "2xl", "46", "48"],
};

export interface CriteriaMatch {
  /** Producto que cumple los criterios. */
  product: Product;
  /** Score de confianza del match (0–1). */
  confidenceScore: number;
}

/**
 * Normaliza un string para comparación: minúsculas, trim, sin acentos opcional.
 */
function normalizeForCompare(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/**
 * Comprueba coincidencia exacta o que uno contenga al otro (normalizado).
 */
function textMatches(criteriaValue: string, productValue: string): boolean {
  const c = normalizeForCompare(criteriaValue);
  const p = normalizeForCompare(productValue);
  if (c === p) return true;
  return p.includes(c) || c.includes(p);
}

/** Texto del producto donde pueden aparecer color, talla, etc. (nombre + descripción). */
function getSearchableText(product: Product): string {
  const parts = [product.name, product.description].filter(Boolean) as string[];
  return parts.join(" ").trim();
}

/** Escapa caracteres especiales de regex para usar en RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Comprueba si el valor buscado aparece en el texto como palabra (o número) para evitar falsos positivos.
 */
function valueAppearsInText(wanted: string, searchableText: string): boolean {
  if (!wanted.trim()) return false;
  const normalized = normalizeForCompare(searchableText);
  const w = normalizeForCompare(wanted);
  const wordBoundary = new RegExp(`\\b${escapeRegex(w)}\\b`, "i");
  return wordBoundary.test(normalized);
}

/**
 * Comprueba si el producto cumple el criterio de precio (priceMin <= precio <= priceMax).
 * priceMin puede venir de la IA (inferido por tipo de producto) o fallback para bicicletas.
 */
function evaluatePrice(product: Product, criteria: Criteria): { pass: boolean; score: number } {
  const min =
    criteria.priceMin ??
    (criteria.productTypeHint?.toLowerCase().trim() === "bicicletas" ? FALLBACK_PRICE_MIN_BICYCLES_EUR : undefined);
  if (min != null && product.price < min) {
    return { pass: false, score: 0 };
  }
  const max = criteria.priceMax;
  if (max == null || typeof max !== "number") {
    return { pass: true, score: 1 };
  }
  const pass = product.price <= max;
  if (!pass) return { pass: false, score: 0 };
  if (max <= 0) return { pass: true, score: 1 };
  const ratio = product.price / max;
  return { pass: true, score: Math.max(0, 1 - ratio * 0.2) };
}

/**
 * Parsea product.size como lista de tallas (p. ej. "M,L,XL" o "L | XL").
 */
function parseSizeList(sizeStr: string): string[] {
  return sizeStr
    .split(/[\s,|/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Comprueba coincidencia de talla (exacta o equivalente: L/Large, 42, etc.).
 * Si la talla no está en el campo dedicado, se busca también en nombre y descripción (ej. "Vaquero 46", "Talla L").
 */
function evaluateSize(product: Product, criteria: Criteria): { pass: boolean; score: number } {
  const wanted = criteria.size?.trim();
  if (!wanted) return { pass: true, score: 1 };

  const searchable = getSearchableText(product);
  const sizeInNameOrDesc = valueAppearsInText(wanted, searchable);

  const productSize = product.size?.trim();
  if (!productSize) {
    if (sizeInNameOrDesc) return { pass: true, score: 0.8 };
    return { pass: true, score: 0.5 };
  }

  const w = normalizeForCompare(wanted);
  const productSizes = parseSizeList(productSize).map((s) => normalizeForCompare(s));

  for (const p of productSizes) {
    if (w === p) return { pass: true, score: 1 };

    for (const variants of Object.values(SIZE_EQUIVALENTS)) {
      const hasWanted = variants.some((v) => normalizeForCompare(v) === w);
      const hasProduct = variants.some((v) => normalizeForCompare(v) === p);
      if (hasWanted && hasProduct) return { pass: true, score: 0.95 };
    }
  }

  if (sizeInNameOrDesc) return { pass: true, score: 0.8 };
  return { pass: false, score: 0 };
}

/**
 * Comprueba si la talla pedida está entre las tallas disponibles (exacta o equivalente).
 * Útil para verificación en página de producto cuando tenemos lista de tallas realmente disponibles.
 *
 * @param wantedSize - Talla solicitada por el usuario (ej. "L", "46")
 * @param availableSizes - Tallas extraídas de la página de detalle (ej. ["XS"], ["36", "38"])
 * @returns true si la talla pedida está disponible
 */
export function isRequestedSizeAvailable(
  wantedSize: string,
  availableSizes: string[]
): boolean {
  const wanted = wantedSize?.trim();
  if (!wanted || availableSizes.length === 0) return true;

  const w = normalizeForCompare(wanted);
  for (const raw of availableSizes) {
    const available = raw?.trim();
    if (!available) continue;
    const p = normalizeForCompare(available);
    if (w === p) return true;
    for (const variants of Object.values(SIZE_EQUIVALENTS)) {
      const hasWanted = variants.some((v) => normalizeForCompare(v) === w);
      const hasAvailable = variants.some((v) => normalizeForCompare(v) === p);
      if (hasWanted && hasAvailable) return true;
    }
  }
  return false;
}

/**
 * Comprueba coincidencia de color (exacta o similar: negro/negra, contiene, etc.).
 * Si el color no está en el campo dedicado, se busca también en nombre y descripción del producto.
 */
function evaluateColor(product: Product, criteria: Criteria): { pass: boolean; score: number } {
  const wanted = criteria.color?.trim();
  if (!wanted) return { pass: true, score: 1 };

  const productColor = product.color?.trim();
  const searchable = getSearchableText(product);
  const inNameOrDesc = valueAppearsInText(wanted, searchable);

  if (productColor) {
    if (textMatches(wanted, productColor)) return { pass: true, score: 1 };
    const w = normalizeForCompare(wanted);
    const p = normalizeForCompare(productColor);
    const wStem = w.replace(/([aeiou])s?$/i, "$1");
    const pStem = p.replace(/([aeiou])s?$/i, "$1");
    if (wStem === pStem || w.startsWith(pStem) || p.startsWith(wStem)) {
      return { pass: true, score: 0.9 };
    }
    if (inNameOrDesc) return { pass: true, score: 0.85 };
    return { pass: false, score: 0 };
  }

  if (inNameOrDesc) return { pass: true, score: 0.85 };
  return { pass: true, score: 0.5 };
}

/**
 * Evalúa un producto frente a los criterios y devuelve el score (0–1).
 * Solo devuelve score > 0 si pasa todos los criterios definidos.
 */
function evaluateProduct(product: Product, criteria: Criteria): number {
  const priceResult = evaluatePrice(product, criteria);
  const sizeResult = evaluateSize(product, criteria);
  const colorResult = evaluateColor(product, criteria);

  if (!priceResult.pass || !sizeResult.pass || !colorResult.pass) {
    return 0;
  }

  const score =
    priceResult.score * WEIGHT_PRICE +
    sizeResult.score * WEIGHT_SIZE +
    colorResult.score * WEIGHT_COLOR;

  return Math.round(score * 100) / 100;
}

/**
 * Calcula el score de match de un producto frente a los criterios (0–1).
 * Útil para re-evaluar un producto extraído de su página de detalle.
 *
 * @param product - Producto a evaluar
 * @param criteria - Criterios del tracking
 * @returns Score en [0, 1]; 0 si no cumple algún criterio obligatorio
 */
export function getMatchScore(product: Product, criteria: Criteria): number {
  return evaluateProduct(product, criteria);
}

/**
 * Filtra productos que cumplen los criterios y tienen confidence score >= 0.7.
 *
 * @param products - Lista de productos a evaluar
 * @param criteria - Criterios del tracking (priceMax, size, color)
 * @param minScore - Score mínimo para incluir (default 0.7)
 * @returns Matches con producto y score, ordenados por score descendente
 */
export function findMatches(
  products: Product[],
  criteria: Criteria,
  minScore: number = MIN_MATCH_SCORE
): CriteriaMatch[] {
  const matches: CriteriaMatch[] = [];

  for (const product of products) {
    const score = evaluateProduct(product, criteria);
    if (score >= minScore) {
      matches.push({ product, confidenceScore: score });
    }
  }

  matches.sort((a, b) => b.confidenceScore - a.confidenceScore);
  return matches;
}
