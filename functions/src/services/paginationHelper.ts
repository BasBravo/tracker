/**
 * Detección de URL de "siguiente página" en listados eCommerce.
 * Heurísticas: rel="next", enlaces con texto "siguiente"/"next", parámetros page/p.
 */

import * as cheerio from "cheerio";

const DEFAULT_MAX_PAGES = 20;

/**
 * Resuelve href respecto a baseUrl (absoluta o relativa).
 */
function resolveUrl(href: string, baseUrl: string): string {
  const s = href.trim();
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  try {
    return new URL(s, baseUrl).href;
  } catch {
    return baseUrl;
  }
}

/**
 * Obtiene la URL de la siguiente página a partir del HTML, si existe.
 * Busca: link rel="next", enlaces con clase/texto de paginación, o incrementa ?page= / ?p=.
 *
 * @param html - HTML de la página actual
 * @param currentUrl - URL de la página actual (para resolver relativas y modificar query)
 * @returns URL de la siguiente página o null si no se detecta
 */
export function getNextPageUrl(html: string, currentUrl: string): string | null {
  const $ = cheerio.load(html);

  const linkNext = $('link[rel="next"]').attr("href");
  if (linkNext) {
    return resolveUrl(linkNext, currentUrl);
  }

  const anchorNext = $('a[rel="next"]').attr("href");
  if (anchorNext) {
    return resolveUrl(anchorNext, currentUrl);
  }

  const nextTextPatterns = [
    "siguiente",
    "next",
    "»",
    "›",
    "weiter",
    "suivant",
    "avanti",
  ];
  let nextFromText: string | null = null;
  $("a[href]").each((_, el) => {
    if (nextFromText) return;
    const $el = $(el);
    const text = $el.text().trim().toLowerCase();
    const href = $el.attr("href");
    if (
      href &&
      href !== "#" &&
      !href.startsWith("javascript:") &&
      nextTextPatterns.some((p) => text.includes(p.toLowerCase()))
    ) {
      const resolved = resolveUrl(href, currentUrl);
      if (resolved !== currentUrl) {
        nextFromText = resolved;
      }
    }
  });
  if (nextFromText) return nextFromText;

  try {
    const url = new URL(currentUrl);
    const pageParam = url.searchParams.get("page") ?? url.searchParams.get("p") ?? url.searchParams.get("pageNumber");
    if (pageParam != null) {
      const num = parseInt(pageParam, 10);
      if (!Number.isNaN(num) && num >= 1) {
        const key = url.searchParams.get("page") != null ? "page" : url.searchParams.get("p") != null ? "p" : "pageNumber";
        url.searchParams.set(key, String(num + 1));
        return url.href;
      }
    }
    if (!pageParam && !url.searchParams.has("page") && !url.searchParams.has("p")) {
      url.searchParams.set("page", "2");
      return url.href;
    }
  } catch {
    // ignore URL parse errors
  }

  return null;
}

/**
 * Límite por defecto de páginas a analizar por ejecución.
 */
export function getDefaultPaginationLimit(): number {
  return DEFAULT_MAX_PAGES;
}
