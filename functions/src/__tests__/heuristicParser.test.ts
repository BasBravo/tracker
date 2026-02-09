/**
 * Tests para heuristicParser: extracción por selectores CSS (fallback).
 */

import {
  extractProductsHeuristic,
  extractWithFallback,
} from "../services/heuristicParser";
import {
  HTML_SINGLE_PRODUCT_PAGE,
  HTML_PRODUCT_CARDS,
  HTML_NO_PRICE,
  HTML_EMPTY,
  HTML_PRODUCT_SCHEMA,
} from "./fixtures/htmlMocks";
import { extractProductsFromHtml } from "../services/schemaExtractor";

const PAGE_URL = "https://example.com/product";

describe("heuristicParser", () => {
  describe("extractProductsHeuristic", () => {
    it("devuelve array vacío para HTML vacío o sin precio", () => {
      expect(extractProductsHeuristic(HTML_EMPTY, PAGE_URL)).toEqual([]);
      expect(extractProductsHeuristic(HTML_NO_PRICE, PAGE_URL)).toEqual([]);
    });

    it("extrae producto único con itemprop (nombre, precio, talla, color, imagen)", () => {
      const result = extractProductsHeuristic(HTML_SINGLE_PRODUCT_PAGE, PAGE_URL);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Camiseta Azul");
      expect(result[0].price).toBe(19.99);
      expect(result[0].currency).toBe("EUR");
      expect(result[0].url).toBe(PAGE_URL);
      expect(result[0].size).toBe("M");
      expect(result[0].color).toBe("azul");
      expect(result[0].image).toContain("/img/camiseta.jpg");
      expect(result[0].confidenceScore).toBeGreaterThanOrEqual(0.5);
      expect(result[0].confidenceScore).toBeLessThanOrEqual(0.7);
    });

    it("extrae múltiples productos desde product-card", () => {
      const result = extractProductsHeuristic(HTML_PRODUCT_CARDS, PAGE_URL);
      expect(result.length).toBeGreaterThanOrEqual(2);
      const names = result.map((r) => r.name);
      expect(names).toContain("Card 1");
      expect(names).toContain("Card 2");
      expect(result.find((r) => r.name === "Card 1")?.price).toBe(29);
      expect(result.find((r) => r.name === "Card 2")?.price).toBe(39.5);
      result.forEach((p) => {
        expect(p.confidenceScore).toBeGreaterThanOrEqual(0.5);
        expect(p.confidenceScore).toBeLessThanOrEqual(0.7);
      });
    });

    it("resuelve URL relativa del enlace en cards", () => {
      const result = extractProductsHeuristic(HTML_PRODUCT_CARDS, "https://shop.com/cat");
      const card1 = result.find((r) => r.name === "Card 1");
      expect(card1?.url).toBe("https://shop.com/p/1");
    });

    it("devuelve confidence score en rango [0.5, 0.7]", () => {
      const result = extractProductsHeuristic(HTML_SINGLE_PRODUCT_PAGE, PAGE_URL);
      expect(result[0].confidenceScore).toBeGreaterThanOrEqual(0.5);
      expect(result[0].confidenceScore).toBeLessThanOrEqual(0.7);
    });

    it("prioriza precio en contexto €/EUR y no usa códigos de modelo (ej. RX810)", () => {
      const html = `
      <div class="product-card">
        <h2 class="product-name">Roadlite:ONfly 7</h2>
        <p>Shimano GRX RX810 GS</p>
        <span class="price">2.499 €</span>
        <span class="old-price">3.499 €</span>
        <a href="/bike/1">Ver</a>
      </div>`;
      const result = extractProductsHeuristic(html, PAGE_URL);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Roadlite:ONfly 7");
      expect(result[0].price).toBe(2499);
    });

    it("no usa 'Ahorra hasta X €' como precio; usa el precio real (ej. Desde 4.199 €)", () => {
      const html = `
      <div class="product-card">
        <h2 class="product-name">Strive:ON CFR Underdog</h2>
        <p>Desde 4.199 €</p>
        <p>Precio original Desde 5.499 €</p>
        <p>Ahorra hasta 1.300 €</p>
        <p>Financiación a partir de 70 €/mes.</p>
        <a href="/bike/3428">Ver</a>
      </div>`;
      const result = extractProductsHeuristic(html, PAGE_URL);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Strive:ON CFR Underdog");
      expect(result[0].price).toBe(4199);
    });

    it("extrae varias tallas disponibles como lista (M,L,XL) para filtrado correcto", () => {
      const html = `
      <div class="product-card">
        <h2 class="product-name">Bike Multi-Talla</h2>
        <p class="price">1.599 €</p>
        <p>Selecciona talla de cuadro S  M  L  XL</p>
        <a href="/bike/1">Ver</a>
      </div>`;
      const result = extractProductsHeuristic(html, PAGE_URL);
      expect(result).toHaveLength(1);
      expect(result[0].size).toBeDefined();
      expect(result[0].size!.split(",").sort()).toEqual(["L", "M", "S", "XL"]);
    });

    it("extrae una sola talla cuando dice 'Disponible para comprar en L'", () => {
      const html = `
      <div class="product-card">
        <h2 class="product-name">Bike Solo L</h2>
        <p class="price">1.799 €</p>
        <p>Disponible para comprar en L</p>
        <a href="/bike/2">Ver</a>
      </div>`;
      const result = extractProductsHeuristic(html, PAGE_URL);
      expect(result).toHaveLength(1);
      expect(result[0].size).toBe("L");
    });
  });

  describe("extractWithFallback", () => {
    it("devuelve productos de schema cuando hay resultados", () => {
      const schemaProducts = extractProductsFromHtml(HTML_PRODUCT_SCHEMA, PAGE_URL);
      expect(schemaProducts.length).toBeGreaterThan(0);
      const result = extractWithFallback(HTML_PRODUCT_SCHEMA, PAGE_URL, schemaProducts);
      expect(result).toEqual(schemaProducts);
      expect(result[0].name).toBe("Camiseta Básica");
      expect(result[0].confidenceScore).toBeGreaterThan(0.7);
    });

    it("usa heurísticas cuando schema devuelve array vacío", () => {
      const schemaProducts = extractProductsFromHtml(HTML_EMPTY, PAGE_URL);
      expect(schemaProducts).toHaveLength(0);
      const result = extractWithFallback(HTML_SINGLE_PRODUCT_PAGE, PAGE_URL, schemaProducts);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("Camiseta Azul");
      expect(result[0].confidenceScore).toBeLessThanOrEqual(0.7);
    });

    it("devuelve array vacío cuando schema vacío y HTML sin productos", () => {
      const result = extractWithFallback(HTML_NO_PRICE, PAGE_URL, []);
      expect(result).toEqual([]);
    });
  });
});
