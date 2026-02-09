/**
 * Tests para criteriaAnalyzer: comparación de productos con criterios.
 */

import { findMatches, isRequestedSizeAvailable, type CriteriaMatch } from "../services/criteriaAnalyzer";
import type { Criteria, Product } from "../types";

describe("criteriaAnalyzer", () => {
  const productBase: Product = {
    name: "Camiseta",
    price: 50,
    currency: "EUR",
    url: "https://example.com/1",
  };

  describe("findMatches", () => {
    it("devuelve array vacío si no hay productos", () => {
      const result = findMatches([], { priceMax: 100 });
      expect(result).toEqual([]);
    });

    it("incluye producto cuando cumple priceMax y no hay size/color", () => {
      const products: Product[] = [
        { ...productBase, price: 80 },
      ];
      const criteria: Criteria = { priceMax: 100 };
      const result = findMatches(products, criteria);
      expect(result).toHaveLength(1);
      expect(result[0].product.price).toBe(80);
      expect(result[0].confidenceScore).toBeGreaterThanOrEqual(0.7);
    });

    it("excluye producto cuando supera priceMax", () => {
      const products: Product[] = [
        { ...productBase, price: 150 },
      ];
      const criteria: Criteria = { priceMax: 100 };
      const result = findMatches(products, criteria);
      expect(result).toHaveLength(0);
    });

    it("incluye producto cuando talla coincide exactamente", () => {
      const products: Product[] = [
        { ...productBase, size: "L" },
      ];
      const criteria: Criteria = { size: "L" };
      const result = findMatches(products, criteria);
      expect(result).toHaveLength(1);
      expect(result[0].product.size).toBe("L");
    });

    it("incluye producto cuando talla es equivalente (L y Large)", () => {
      const products: Product[] = [
        { ...productBase, size: "Large" },
      ];
      const criteria: Criteria = { size: "L" };
      const result = findMatches(products, criteria);
      expect(result).toHaveLength(1);
    });

    it("excluye producto cuando talla no coincide", () => {
      const products: Product[] = [
        { ...productBase, size: "S" },
      ];
      const criteria: Criteria = { size: "L" };
      const result = findMatches(products, criteria);
      expect(result).toHaveLength(0);
    });

    it("incluye producto sin talla con score menor cuando usuario pide talla L (filtro IA puede depurar después)", () => {
      const products: Product[] = [
        { ...productBase, price: 100 },
      ];
      const criteria: Criteria = { size: "L", priceMax: 200 };
      const result = findMatches(products, criteria);
      expect(result).toHaveLength(1);
      expect(result[0].confidenceScore).toBeLessThan(1);
    });

    it("incluye producto cuando la talla pedida está en la lista de tallas (M,L,XL)", () => {
      const products: Product[] = [
        { ...productBase, size: "M,L,XL" },
      ];
      const criteria: Criteria = { size: "L" };
      const result = findMatches(products, criteria);
      expect(result).toHaveLength(1);
    });

    it("excluye producto cuando la talla pedida no está en la lista (solo M,XL)", () => {
      const products: Product[] = [
        { ...productBase, size: "M,XL" },
      ];
      const criteria: Criteria = { size: "L" };
      const result = findMatches(products, criteria);
      expect(result).toHaveLength(0);
    });

    it("incluye producto cuando color coincide", () => {
      const products: Product[] = [
        { ...productBase, color: "negro" },
      ];
      const criteria: Criteria = { color: "negro" };
      const result = findMatches(products, criteria);
      expect(result).toHaveLength(1);
      expect(result[0].product.color).toBe("negro");
    });

    it("excluye producto cuando color no coincide", () => {
      const products: Product[] = [
        { ...productBase, color: "blanco" },
      ];
      const criteria: Criteria = { color: "negro" };
      const result = findMatches(products, criteria);
      expect(result).toHaveLength(0);
    });

    it("incluye producto cuando el color pedido aparece en el nombre (sin campo color)", () => {
      const products: Product[] = [
        { ...productBase, name: "Vaquero recto negro", price: 30 },
      ];
      const criteria: Criteria = { color: "negro", priceMax: 35 };
      const result = findMatches(products, criteria);
      expect(result).toHaveLength(1);
      expect(result[0].confidenceScore).toBeGreaterThanOrEqual(0.7);
    });

    it("incluye producto cuando la talla pedida aparece en el nombre (sin campo size)", () => {
      const products: Product[] = [
        { ...productBase, name: "Vaquero slim talla 46", price: 32 },
      ];
      const criteria: Criteria = { size: "46", priceMax: 40 };
      const result = findMatches(products, criteria);
      expect(result).toHaveLength(1);
      expect(result[0].confidenceScore).toBeGreaterThanOrEqual(0.7);
    });

    it("combina priceMax, size y color", () => {
      const products: Product[] = [
        { ...productBase, price: 60, size: "M", color: "azul" },
        { ...productBase, price: 200, size: "M", color: "azul" },
        { ...productBase, price: 60, size: "S", color: "azul" },
        { ...productBase, price: 60, size: "M", color: "rojo" },
        { ...productBase, price: 60, size: "M", color: "azul", url: "https://example.com/2" },
      ];
      const criteria: Criteria = { priceMax: 100, size: "M", color: "azul" };
      const result = findMatches(products, criteria);
      expect(result.length).toBe(2);
      result.forEach((m: CriteriaMatch) => {
        expect(m.product.price).toBeLessThanOrEqual(100);
        expect(m.product.size).toBe("M");
        expect(m.product.color).toBe("azul");
      });
    });

    it("ordena por confidenceScore descendente", () => {
      const products: Product[] = [
        { ...productBase, price: 50, size: "L", color: "negro" },
        { ...productBase, price: 30, size: "L", color: "negro", url: "https://example.com/2" },
      ];
      const criteria: Criteria = { priceMax: 100, size: "L", color: "negro" };
      const result = findMatches(products, criteria);
      expect(result.length).toBe(2);
      expect(result[0].confidenceScore).toBeGreaterThanOrEqual(result[1].confidenceScore);
    });

    it("respeta minScore cuando se pasa", () => {
      const products: Product[] = [
        { ...productBase, price: 80, size: "L", color: "negro" },
      ];
      const criteria: Criteria = { priceMax: 100, size: "L", color: "negro" };
      const high = findMatches(products, criteria, 0.9);
      const low = findMatches(products, criteria, 0.5);
      expect(high.length).toBeLessThanOrEqual(low.length);
    });

    it("sin criterios incluye todos los productos con score", () => {
      const products: Product[] = [
        { ...productBase, price: 10 },
      ];
      const result = findMatches(products, {});
      expect(result).toHaveLength(1);
      expect(result[0].confidenceScore).toBeGreaterThanOrEqual(0.7);
    });

    it("excluye bicicletas con precio imposible (productTypeHint + price < 100)", () => {
      const products: Product[] = [
        { ...productBase, name: "Inflite CF SL 5", price: 7, size: "L" },
        { ...productBase, name: "Spectral 125 AL 5", price: 1799, size: "L", url: "https://example.com/2" },
      ];
      const criteria: Criteria = { priceMax: 2000, size: "L", productTypeHint: "bicicletas" };
      const result = findMatches(products, criteria);
      expect(result).toHaveLength(1);
      expect(result[0].product.price).toBe(1799);
    });

    it("respeta priceMin cuando viene en criterios (ej. inferido por IA)", () => {
      const products: Product[] = [
        { ...productBase, name: "Zapato low cost", price: 5, url: "https://example.com/1" },
        { ...productBase, name: "Zapatilla running", price: 89, url: "https://example.com/2" },
      ];
      const criteria: Criteria = { priceMax: 100, priceMin: 15 };
      const result = findMatches(products, criteria);
      expect(result).toHaveLength(1);
      expect(result[0].product.price).toBe(89);
    });
  });

  describe("isRequestedSizeAvailable", () => {
    it("devuelve true si no hay talla pedida", () => {
      expect(isRequestedSizeAvailable("", ["XS", "S"])).toBe(true);
      expect(isRequestedSizeAvailable("L", [])).toBe(true);
    });

    it("devuelve true si la talla pedida está en la lista", () => {
      expect(isRequestedSizeAvailable("L", ["XS", "S", "M", "L", "XL"])).toBe(true);
      expect(isRequestedSizeAvailable("46", ["36", "38", "40", "42", "44", "46"])).toBe(true);
      expect(isRequestedSizeAvailable("L", ["L"])).toBe(true);
    });

    it("devuelve false si la talla pedida no está en la lista", () => {
      expect(isRequestedSizeAvailable("L", ["XS"])).toBe(false);
      expect(isRequestedSizeAvailable("46", ["36"])).toBe(false);
      expect(isRequestedSizeAvailable("L", ["S", "M", "XL"])).toBe(false);
    });

    it("acepta equivalentes (L y Large, 42 y L)", () => {
      expect(isRequestedSizeAvailable("L", ["Large"])).toBe(true);
      expect(isRequestedSizeAvailable("L", ["42", "44"])).toBe(true);
    });
  });
});
