/**
 * Extrae tallas y colores realmente disponibles en la página de detalle del producto.
 * Usado en la verificación de matches: si el usuario pide talla L y solo hay XS, se descarta.
 * Fuentes: parámetros de URL (Canyon, etc.) y HTML (selectores, botones, texto).
 */

import * as cheerio from "cheerio";

export interface PageAvailability {
  /** Tallas que aparecen como disponibles/seleccionables en la página. */
  availableSizes: string[];
  /** Colores disponibles (opcional). */
  availableColors: string[];
}

/** Patrón para extraer talla desde query string (Canyon: dwvar_*_rahmengroesse=XS). */
const SIZE_FROM_URL_REGEX = /(?:^|&)(?:dwvar_[^=]*_)?rahmengroesse=([^&]+)/i;

/**
 * Extrae la talla indicada en la URL (ej. Canyon: dwvar_3732_pv_rahmengroesse=XS).
 * Si la URL define una sola variante de talla, esa es la única disponible en esa página.
 */
function extractSizesFromUrl(pageUrl: string): string[] {
  try {
    const url = new URL(pageUrl);
    const search = url.searchParams.toString() || url.search.slice(1);
    const match = search.match(SIZE_FROM_URL_REGEX);
    if (match && match[1]) {
      const value = decodeURIComponent(match[1].trim());
      if (value.length <= 5) return [value];
    }
    return [];
  } catch {
    return [];
  }
}

/** Selectores para opciones de talla en HTML. */
const SIZE_SELECTORS = [
  "select[name*='size'] option:not([disabled])",
  "select[name*='talla'] option:not([disabled])",
  "select[id*='size'] option:not([disabled])",
  "[data-size]:not(.disabled):not([aria-disabled='true'])",
  "[data-value][data-attr='size']",
  ".size-option:not(.disabled):not(.unavailable)",
  ".size-selector button:not([disabled])",
  "[class*='sizeSelector'] button:not([disabled])",
  "[class*='SizeOption']:not([class*='unavailable']):not([class*='disabled'])",
  "button[data-size]",
  "a[data-size]",
];

/** Clases o atributos que marcan opción no disponible. */
const UNAVAILABLE_MARKERS = [
  "disabled",
  "unavailable",
  "out-of-stock",
  "agotado",
  "no-stock",
  "sold-out",
  "outofstock",
];

function isElementAvailable($: cheerio.CheerioAPI, el: cheerio.Cheerio<any>): boolean {
  const cls = (el.attr("class") ?? "").toLowerCase();
  const ariaDisabled = el.attr("aria-disabled");
  if (ariaDisabled === "true") return false;
  for (const m of UNAVAILABLE_MARKERS) {
    if (cls.includes(m.toLowerCase())) return false;
  }
  return true;
}

/** Token de talla: XS, S, M, L, XL, números 36-52, etc. */
const SIZE_TOKEN_REGEX = /\b(3XS|2XS|XS|S|M|L|XL|2XL|3XL|\d{2})\b/gi;

/** Solo consideramos tallas que coincidan con este patrón (evita "de", "info", etc.). */
const VALID_SIZE_PATTERN = /^(3XS|2XS|XS|S|M|L|XL|2XL|3XL|\d{2})$/i;

/**
 * Extrae tokens que parecen tallas desde un texto (ej. "Selecciona talla XS" o "36  38  40").
 */
function extractSizeTokensFromText(text: string): string[] {
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(SIZE_TOKEN_REGEX.source, "gi");
  while ((m = re.exec(text)) !== null) {
    tokens.push(m[1].trim());
  }
  return [...new Set(tokens)];
}

/**
 * Busca en el HTML un bloque de "Selecciona talla" / "Talla" y extrae las tallas que aparecen.
 * Si solo hay un botón o una opción visible (ej. Canyon con solo "XS"), devuelve esa.
 */
function extractSizesFromHtmlText(html: string): string[] {
  const $ = cheerio.load(html);
  const text = $("body").text() ?? "";
  const normalized = text.replace(/\s+/g, " ").trim();

  const singleSizePatterns = [
    /Selecciona talla de cuadro\s+([A-Z0-9]+)(?:\s|$)/i,
    /Selecciona talla\s*[:\s]*([A-Z0-9]+)(?:\s|$)/i,
    /(?:talla|size)\s*[:\s]*([A-Z0-9]+)(?:\s+Entrega|\s+Añadir|\s*$)/i,
  ];
  for (const re of singleSizePatterns) {
    const match = normalized.match(re);
    if (match && match[1]) {
      const size = match[1].trim();
      if (size.length <= 5 && VALID_SIZE_PATTERN.test(size)) return [size];
    }
  }

  const sizeContext = /(?:talla|size|selecciona|cuadro|disponible)/i;
  if (!sizeContext.test(normalized)) return [];

  const tokens = extractSizeTokensFromText(normalized).filter((t) => VALID_SIZE_PATTERN.test(t));
  if (tokens.length > 0 && tokens.length <= 15) return tokens;
  return [];
}

/**
 * Extrae tallas desde elementos del DOM: selects, botones, data-attributes.
 * Solo considera elementos que no están marcados como disabled/unavailable.
 */
function extractSizesFromHtmlElements($: cheerio.CheerioAPI): string[] {
  const sizes: string[] = [];

  for (const selector of SIZE_SELECTORS) {
    try {
      $(selector).each((_, el) => {
        const $el = $(el);
        if (!isElementAvailable($, $el)) return;

        const value =
          $el.attr("data-size") ??
          $el.attr("data-value") ??
          $el.attr("value") ??
          $el.text().trim();
        const cleaned = value?.trim();
        if (
          cleaned &&
          cleaned.length <= 5 &&
          VALID_SIZE_PATTERN.test(cleaned) &&
          !sizes.includes(cleaned)
        ) {
          sizes.push(cleaned);
        }
      });
    } catch {
      // selector puede no existir
    }
  }

  if (sizes.length > 0) return sizes;

  const selectOptions: string[] = [];
  $("select[name*='size'] option, select[name*='talla'] option, select[id*='size'] option").each(
    (_, el) => {
      const $opt = $(el);
      if ($opt.attr("disabled")) return;
      const val = ($opt.attr("value") ?? $opt.text()).trim();
      if (val && val.length <= 5 && VALID_SIZE_PATTERN.test(val)) {
        selectOptions.push(val);
      }
    }
  );
  if (selectOptions.length > 0) return [...new Set(selectOptions)];

  return [];
}

/**
 * Extrae disponibilidad (tallas y colores) desde la URL y el HTML de la página de producto.
 * Combina: parámetros de URL (Canyon) y análisis del DOM/texto (Celio, genérico).
 *
 * @param html - HTML de la página de detalle
 * @param pageUrl - URL de la página (puede contener variante de talla)
 * @returns Listas de tallas y colores disponibles
 */
export function extractAvailabilityFromProductPage(
  html: string,
  pageUrl: string
): PageAvailability {
  const fromUrl = extractSizesFromUrl(pageUrl);
  const $ = cheerio.load(html);
  const fromElements = extractSizesFromHtmlElements($);
  const fromText = extractSizesFromHtmlText(html);

  let availableSizes: string[] = [];
  if (fromUrl.length > 0) {
    availableSizes = fromUrl;
  } else if (fromElements.length > 0) {
    availableSizes = fromElements;
  } else if (fromText.length > 0) {
    availableSizes = fromText;
  }

  const availableColors: string[] = [];
  $("[data-color]:not(.disabled), .color-option:not(.disabled), select[name*='color'] option:not([disabled])").each(
    (_, el) => {
      const val = $(el).attr("data-color") ?? $(el).attr("data-value") ?? $(el).text().trim();
      if (val && val.length < 50 && !availableColors.includes(val)) availableColors.push(val);
    }
  );

  return {
    availableSizes: [...new Set(availableSizes)],
    availableColors,
  };
}
