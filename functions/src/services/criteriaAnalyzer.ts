/**
 * Análisis de productos frente a criterios de tracking.
 * Evalúa precio, talla y color (exacto o similar) y calcula confidence score.
 */

import type { Criteria, Product } from "../types";

/** Score mínimo para considerar un match (inclusive). */
const MIN_MATCH_SCORE = 0.7;

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

/**
 * Comprueba si el producto cumple el criterio de precio (precio <= priceMax).
 */
function evaluatePrice(product: Product, criteria: Criteria): { pass: boolean; score: number } {
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
 * Comprueba coincidencia de talla (exacta o equivalente: L/Large, 42, etc.).
 */
function evaluateSize(product: Product, criteria: Criteria): { pass: boolean; score: number } {
  const wanted = criteria.size?.trim();
  if (!wanted) return { pass: true, score: 1 };

  const productSize = product.size?.trim();
  if (!productSize) return { pass: false, score: 0 };

  const w = normalizeForCompare(wanted);
  const p = normalizeForCompare(productSize);

  if (w === p) return { pass: true, score: 1 };

  for (const variants of Object.values(SIZE_EQUIVALENTS)) {
    const hasWanted = variants.some((v) => normalizeForCompare(v) === w);
    const hasProduct = variants.some((v) => normalizeForCompare(v) === p);
    if (hasWanted && hasProduct) return { pass: true, score: 0.95 };
  }

  if (p.includes(w) || w.includes(p)) return { pass: true, score: 0.85 };

  return { pass: false, score: 0 };
}

/**
 * Comprueba coincidencia de color (exacta o similar: negro/negra, contiene, etc.).
 */
function evaluateColor(product: Product, criteria: Criteria): { pass: boolean; score: number } {
  const wanted = criteria.color?.trim();
  if (!wanted) return { pass: true, score: 1 };

  const productColor = product.color?.trim();
  if (!productColor) return { pass: false, score: 0 };

  if (textMatches(wanted, productColor)) return { pass: true, score: 1 };

  const w = normalizeForCompare(wanted);
  const p = normalizeForCompare(productColor);

  const wStem = w.replace(/([aeiou])s?$/i, "$1");
  const pStem = p.replace(/([aeiou])s?$/i, "$1");
  if (wStem === pStem || w.startsWith(pStem) || p.startsWith(wStem)) {
    return { pass: true, score: 0.9 };
  }

  return { pass: false, score: 0 };
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
