/**
 * Tests del cliente HTTP: detección de anti-bot y comportamiento ante respuestas JSON.
 */

import axios from "axios";
import { fetchHtml, FetchHtmlError, FETCH_ERROR_ANTIBOT } from "../services/httpClient";

const ANTIBOT_JSON = JSON.stringify({
  errors: [{ code: "bot-need-challenge", message: "Forbidden", challengePath: "/testchallengepage" }],
});

describe("httpClient", () => {
  describe("fetchHtml - detección anti-bot", () => {
    it("lanza FetchHtmlError con código ANTIBOT cuando el cuerpo es JSON bot-need-challenge", async () => {
      const client = axios.create({
        timeout: 5000,
        validateStatus: () => true,
      });
      client.request = jest.fn().mockResolvedValue({
        data: ANTIBOT_JSON,
        status: 200,
        config: { url: "https://www.backmarket.es/test" },
        request: {},
      });

      await expect(fetchHtml("https://www.backmarket.es/test", { client })).rejects.toThrow(FetchHtmlError);
      await expect(fetchHtml("https://www.backmarket.es/test", { client })).rejects.toMatchObject({
        code: FETCH_ERROR_ANTIBOT,
        message: expect.stringContaining("anti-bot"),
      });
    });

    it("devuelve HTML normalmente cuando el cuerpo no es challenge", async () => {
      const html = "<html><body>Hello</body></html>";
      const client = axios.create({
        timeout: 5000,
        validateStatus: () => true,
      });
      client.request = jest.fn().mockResolvedValue({
        data: html,
        status: 200,
        config: { url: "https://example.com" },
        request: {},
      });

      const result = await fetchHtml("https://example.com", { client });
      expect(result.html).toBe(html);
      expect(result.status).toBe(200);
    });
  });
});
