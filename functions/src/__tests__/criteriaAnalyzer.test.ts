/**
 * Tests para criteriaAnalyzer: comparación de productos con criterios.
 */

import { findMatches, type CriteriaMatch } from "../services/criteriaAnalyzer";
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
  });
});
