/**
 * Tests para availabilityExtractor: extracción de tallas/colores disponibles en página de producto.
 */

import { extractAvailabilityFromProductPage } from "../services/availabilityExtractor";

describe("availabilityExtractor", () => {
  describe("extractAvailabilityFromProductPage", () => {
    it("extrae talla desde URL Canyon (rahmengroesse=XS)", () => {
      const url =
        "https://www.canyon.com/es-es/bicicletas-de-montana/kids-bikes/lux-world-cup-young-hero/lux-world-cup-cf-young-hero/3732.html?dwvar_3732_pv_rahmenfarbe=M115_P12&dwvar_3732_pv_rahmengroesse=XS";
      const html = "<body><h1>Product</h1></body>";
      const result = extractAvailabilityFromProductPage(html, url);
      expect(result.availableSizes).toContain("XS");
      expect(result.availableSizes.length).toBe(1);
    });

    it("extrae talla única desde texto tipo Canyon (Selecciona talla de cuadro XS)", () => {
      const html = `
        <body>
          <h1>Lux World Cup CF Young Hero</h1>
          <p>Selecciona talla de cuadro</p>
          <p>¿Cuál es mi talla?</p>
          <button>XS</button>
          <p>Entrega en 3-10 días</p>
        </body>
      `;
      const result = extractAvailabilityFromProductPage(html, "https://example.com/product");
      expect(result.availableSizes).toContain("XS");
      expect(result.availableSizes.length).toBeGreaterThanOrEqual(1);
    });

    it("extrae varias tallas desde select no deshabilitadas", () => {
      const html = `
        <body>
          <select name="size">
            <option value="36">36</option>
            <option value="38" disabled>38</option>
            <option value="40">40</option>
            <option value="42" disabled>42</option>
          </select>
        </body>
      `;
      const result = extractAvailabilityFromProductPage(html, "https://celio.com/p/123");
      expect(result.availableSizes).toContain("36");
      expect(result.availableSizes).toContain("40");
      expect(result.availableSizes).not.toContain("38");
      expect(result.availableSizes).not.toContain("42");
    });

    it("devuelve availableSizes vacío si no hay pistas en URL ni HTML", () => {
      const html = "<body><h1>Generic product</h1><p>No size info</p></body>";
      const result = extractAvailabilityFromProductPage(html, "https://example.com/p/1");
      expect(result.availableSizes).toEqual([]);
    });
  });
});
