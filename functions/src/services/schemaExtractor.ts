/**
 * Extracción de JSON-LD (schema.org) desde HTML.
 * Soporta Product, Offer, ItemList; normaliza precios y propiedades (talla, color).
 */

import { parse } from "node-html-parser";
import type { Product } from "../types";

/** Tipos schema.org que nos interesan. */
const TARGET_TYPES = ["Product", "Offer", "ItemList"];

/** Regex para limpiar precio: símbolos de moneda, espacios, agrupación de miles. */
const PRICE_CLEAN_REGEX = /[^\d.,\-]/g;

/** Moneda por defecto cuando no se indica. */
const DEFAULT_CURRENCY = "EUR";

/** Caracteres decimales: coma o punto. */
const DECIMAL_SEP = /[,.]/;

interface RawJsonLd {
  "@context"?: string | string[];
  "@type"?: string | string[];
  name?: string;
  description?: string;
  image?: string | string[];
  url?: string;
  sku?: string;
  gtin?: string;
  brand?: { "@type"?: string; name?: string };
  offers?: RawOffer | RawOffer[];
  additionalProperty?: RawPropertyValue[];
  /** ItemList */
  itemListElement?: RawListItem[];
  /** Offer */
  price?: number | string;
  priceCurrency?: string;
  availability?: string;
  priceValidUntil?: string;
  itemOffered?: RawJsonLd;
}

interface RawOffer {
  "@type"?: string;
  price?: number | string;
  priceCurrency?: string;
  availability?: string;
  url?: string;
  itemOffered?: RawJsonLd;
}

interface RawPropertyValue {
  "@type"?: string;
  name?: string;
  value?: string | number;
}

interface RawListItem {
  "@type"?: string;
  item?: RawJsonLd;
  url?: string;
  name?: string;
}

export interface ExtractedProduct extends Product {
  /** Score de completitud de datos (0–1). */
  confidenceScore: number;
}

/**
 * Extrae todos los bloques JSON-LD del HTML.
 */
function extractJsonLdBlocks(html: string): unknown[] {
  const root = parse(html);
  const scripts = root.querySelectorAll('script[type="application/ld+json"]');
  const results: unknown[] = [];

  for (const script of scripts) {
    const text = script.textContent?.trim();
    if (!text) continue;
    try {
      const data = JSON.parse(text) as unknown;
      if (Array.isArray(data)) {
        results.push(...data);
      } else {
        results.push(data);
      }
    } catch {
      // JSON inválido, ignorar bloque
    }
  }

  return results;
}

/**
 * Comprueba si un objeto tiene uno de los tipos objetivo.
 */
function hasTargetType(obj: RawJsonLd): string | null {
  const type = obj["@type"];
  if (!type) return null;
  const types = Array.isArray(type) ? type : [type];
  for (const t of types) {
    if (typeof t === "string" && TARGET_TYPES.includes(t)) {
      return t;
    }
  }
  return null;
}

/**
 * Normaliza un valor de precio a número (quita símbolos, coma decimal).
 */
function normalizePrice(value: unknown): number | null {
  if (typeof value === "number" && !Number.isNaN(value)) {
    return value >= 0 ? value : null;
  }
  if (typeof value !== "string") return null;
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

/**
 * Obtiene la primera imagen (URL) de un campo image.
 */
function firstImage(image: string | string[] | undefined): string | undefined {
  if (!image) return undefined;
  const url = Array.isArray(image) ? image[0] : image;
  return typeof url === "string" && url.trim().length > 0 ? url.trim() : undefined;
}

/**
 * Extrae moneda de una oferta o producto.
 */
function extractCurrency(obj: RawOffer | RawJsonLd): string {
  const raw = obj as RawJsonLd;
  const firstOffer = raw.offers == null ? undefined : Array.isArray(raw.offers) ? raw.offers[0] : raw.offers;
  const currency = obj.priceCurrency ?? firstOffer?.priceCurrency;
  if (typeof currency === "string" && currency.trim().length > 0) {
    return currency.trim().toUpperCase().slice(0, 3);
  }
  return DEFAULT_CURRENCY;
}

/**
 * Extrae talla y color de additionalProperty (o de nombre de propiedad similar).
 */
function extractSizeAndColor(additionalProperty: RawPropertyValue[] | undefined): {
  size?: string;
  color?: string;
} {
  const result: { size?: string; color?: string } = {};
  if (!Array.isArray(additionalProperty)) return result;

  const nameLower = (s: string) => s.toLowerCase().trim();
  const sizeNames = ["size", "talla", "talle", "clothing size"];
  const colorNames = ["color", "colour", "color name"];

  for (const prop of additionalProperty) {
    const name = (prop.name ?? "").toString().toLowerCase();
    const value = prop.value != null ? String(prop.value).trim() : "";
    if (!value) continue;

    if (sizeNames.some((n) => name.includes(n) || nameLower(name).includes(n))) {
      result.size = value;
    }
    if (colorNames.some((n) => name.includes(n) || nameLower(name).includes(n))) {
      result.color = value;
    }
  }
  return result;
}

/**
 * Construye un Product normalizado desde un objeto Product/Offer de schema.org.
 */
function buildProduct(
  raw: RawJsonLd,
  offer: RawOffer | null,
  pageUrl: string
): Omit<ExtractedProduct, "confidenceScore"> | null {
  const name = typeof raw.name === "string" ? raw.name.trim() : undefined;
  const url = typeof raw.url === "string" ? raw.url.trim() : pageUrl;

  let price: number | null = null;
  let currency = DEFAULT_CURRENCY;

  if (offer) {
    price = normalizePrice(offer.price);
    currency = extractCurrency(offer);
  }
  if (price == null && raw.offers) {
    const offers = Array.isArray(raw.offers) ? raw.offers : [raw.offers];
    const first = offers[0];
    if (first) {
      price = normalizePrice(first.price);
      currency = extractCurrency(first);
    }
  }
  if (price == null) return null;

  const { size, color } = extractSizeAndColor(raw.additionalProperty);
  const image = firstImage(raw.image);

  return {
    name: name ?? "Producto sin nombre",
    price,
    currency,
    url,
    ...(size && { size }),
    ...(color && { color }),
    ...(image && { image }),
  };
}

/**
 * Recorre un objeto JSON-LD y recolecta todos los productos (Product/Offer/ItemList).
 */
function collectProductsFromNode(
  node: RawJsonLd,
  pageUrl: string,
  collected: Map<string, Omit<ExtractedProduct, "confidenceScore">>
): void {
  const type = hasTargetType(node);
  if (!type) return;

  if (type === "Product") {
    const offer = node.offers
      ? Array.isArray(node.offers)
        ? node.offers[0]
        : node.offers
      : null;
    const product = buildProduct(node, offer, pageUrl);
    if (product) {
      const key = `${product.name}|${product.url}|${product.price}`;
      collected.set(key, product);
    }
  }

  if (type === "Offer") {
    const itemOffered = node.itemOffered as RawJsonLd | undefined;
    const product = buildProduct(
      itemOffered ?? { name: "Oferta", url: pageUrl },
      node as RawOffer,
      pageUrl
    );
    if (product) {
      const key = `${product.name}|${product.url}|${product.price}`;
      collected.set(key, product);
    }
    if (itemOffered && typeof itemOffered === "object") {
      collectProductsFromNode(itemOffered, pageUrl, collected);
    }
  }

  if (type === "ItemList") {
    const items = node.itemListElement;
    if (Array.isArray(items)) {
      for (const el of items) {
        const item = el?.item ?? el;
        if (item && typeof item === "object") {
          collectProductsFromNode(item as RawJsonLd, pageUrl, collected);
        }
      }
    }
  }
}

/**
 * Calcula el score de confianza (0–1) según completitud de datos del producto.
 * Campos considerados: name, price, currency, url, image, size, color.
 */
export function computeConfidenceScore(product: Product): number {
  let score = 0;
  let total = 0;

  const add = (present: boolean, weight: number) => {
    total += weight;
    if (present) score += weight;
  };

  add(!!(product.name?.trim()), 2);
  add(typeof product.price === "number" && product.price >= 0, 2);
  add(!!(product.currency?.trim()), 1);
  add(!!(product.url?.trim()), 2);
  add(!!(product.image?.trim()), 1);
  add(!!(product.size?.trim()), 1);
  add(!!(product.color?.trim()), 1);

  if (total === 0) return 0;
  return Math.round((score / total) * 100) / 100;
}

/**
 * Extrae productos estructurados del HTML (schema.org JSON-LD).
 *
 * @param html - HTML de la página
 * @param pageUrl - URL de la página (para URLs relativas y contexto)
 * @returns Array de productos con confidence score
 */
export function extractProductsFromHtml(html: string, pageUrl: string): ExtractedProduct[] {
  const blocks = extractJsonLdBlocks(html);
  const collected = new Map<string, Omit<ExtractedProduct, "confidenceScore">>();

  for (const block of blocks) {
    if (block && typeof block === "object" && !Array.isArray(block)) {
      collectProductsFromNode(block as RawJsonLd, pageUrl, collected);
    }
  }

  const products: ExtractedProduct[] = [];
  for (const product of collected.values()) {
    const score = computeConfidenceScore(product);
    products.push({ ...product, confidenceScore: score });
  }

  return products;
}
