/**
 * Tests para schemaExtractor: extracción de JSON-LD (Product, Offer, ItemList).
 */

import {
  extractProductsFromHtml,
  extractProductsFromEmbeddedJson,
  computeConfidenceScore,
} from "../services/schemaExtractor";
import type { Product } from "../types";
import {
  HTML_EMPTY,
  HTML_NO_JSON_LD,
  HTML_PRODUCT_SCHEMA,
  HTML_PRODUCT_SCHEMA_PRICE_STRING,
  HTML_ITEMLIST_SCHEMA,
  HTML_OFFER_SCHEMA,
  HTML_INVALID_JSON_LD,
  HTML_PRODUCT_NO_PRICE,
} from "./fixtures/htmlMocks";

const PAGE_URL = "https://example.com/page";

describe("schemaExtractor", () => {
  describe("extractProductsFromHtml", () => {
    it("devuelve array vacío si el HTML no tiene JSON-LD", () => {
      const result = extractProductsFromHtml(HTML_EMPTY, PAGE_URL);
      expect(result).toEqual([]);
    });

    it("devuelve array vacío si no hay script ld+json", () => {
      const result = extractProductsFromHtml(HTML_NO_JSON_LD, PAGE_URL);
      expect(result).toEqual([]);
    });

    it("extrae un Product con nombre, precio, url, size, color e image", () => {
      const result = extractProductsFromHtml(HTML_PRODUCT_SCHEMA, PAGE_URL);
      expect(result).toHaveLength(1);
      const p = result[0];
      expect(p.name).toBe("Camiseta Básica");
      expect(p.price).toBe(29.99);
      expect(p.currency).toBe("EUR");
      expect(p.url).toBe("https://example.com/camiseta");
      expect(p.size).toBe("L");
      expect(p.color).toBe("negro");
      expect(p.image).toBe("https://example.com/img/camiseta.jpg");
      expect(typeof p.confidenceScore).toBe("number");
      expect(p.confidenceScore).toBeGreaterThanOrEqual(0);
      expect(p.confidenceScore).toBeLessThanOrEqual(1);
    });

    it("normaliza precio en formato string con coma decimal", () => {
      const result = extractProductsFromHtml(HTML_PRODUCT_SCHEMA_PRICE_STRING, PAGE_URL);
      expect(result).toHaveLength(1);
      expect(result[0].price).toBe(89.99);
      expect(result[0].currency).toBe("EUR");
    });

    it("extrae múltiples productos desde ItemList", () => {
      const result = extractProductsFromHtml(HTML_ITEMLIST_SCHEMA, PAGE_URL);
      expect(result.length).toBeGreaterThanOrEqual(2);
      const names = result.map((r) => r.name);
      expect(names).toContain("Producto A");
      expect(names).toContain("Producto B");
      expect(result.find((r) => r.name === "Producto A")?.price).toBe(10);
      expect(result.find((r) => r.name === "Producto B")?.price).toBe(20);
    });

    it("extrae producto desde Offer con itemOffered", () => {
      const result = extractProductsFromHtml(HTML_OFFER_SCHEMA, PAGE_URL);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Oferta Producto");
      expect(result[0].price).toBe(15.5);
      expect(result[0].url).toBe("https://example.com/oferta");
    });

    it("ignora bloques JSON-LD inválidos y no lanza", () => {
      const result = extractProductsFromHtml(HTML_INVALID_JSON_LD, PAGE_URL);
      expect(result).toEqual([]);
    });

    it("no incluye productos sin precio (solo name/url)", () => {
      const result = extractProductsFromHtml(HTML_PRODUCT_NO_PRICE, PAGE_URL);
      expect(result).toEqual([]);
    });

    it("usa pageUrl cuando el producto no tiene url", () => {
      const result = extractProductsFromHtml(HTML_PRODUCT_SCHEMA_PRICE_STRING, PAGE_URL);
      expect(result[0].url).toBe(PAGE_URL);
    });
  });

  describe("computeConfidenceScore", () => {
    it("devuelve 0 para producto vacío/inválido", () => {
      expect(computeConfidenceScore({ name: "", price: -1, currency: "", url: "" })).toBe(0);
    });

    it("devuelve score mayor con más campos completos", () => {
      const minimal: Product = {
        name: "X",
        price: 10,
        currency: "EUR",
        url: "https://a.com",
      };
      const full: Product = {
        ...minimal,
        size: "L",
        color: "negro",
        image: "https://a.com/img.jpg",
      };
      const scoreMin = computeConfidenceScore(minimal);
      const scoreFull = computeConfidenceScore(full);
      expect(scoreFull).toBeGreaterThan(scoreMin);
      expect(scoreMin).toBeGreaterThan(0);
      expect(scoreFull).toBeLessThanOrEqual(1);
    });

    it("devuelve valor entre 0 y 1 para producto válido", () => {
      const p: Product = {
        name: "Test",
        price: 99,
        currency: "EUR",
        url: "https://example.com",
      };
      const score = computeConfidenceScore(p);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  describe("extractProductsFromEmbeddedJson", () => {
    it("devuelve array vacío si no hay script con JSON de datos", () => {
      const result = extractProductsFromEmbeddedJson(HTML_EMPTY, PAGE_URL);
      expect(result).toEqual([]);
    });

    it("extrae productos desde __NEXT_DATA__ con array de objetos name/price", () => {
      const html = `
        <html><body>
          <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
            props: { pageProps: { data: { products: [{ name: "Apple Watch SE", price: 249, url: "/es-es/p/aw-se-1" }] } } },
          })}</script>
        </body></html>
      `;
      const result = extractProductsFromEmbeddedJson(html, "https://www.backmarket.es/");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Apple Watch SE");
      expect(result[0].price).toBe(249);
      expect(result[0].url).toBe("https://www.backmarket.es/es-es/p/aw-se-1");
      expect(result[0].confidenceScore).toBeGreaterThanOrEqual(0);
    });
  });
});
