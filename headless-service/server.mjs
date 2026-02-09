/**
 * Servicio HTTP que renderiza una URL con Puppeteer y devuelve el HTML.
 * Contrato: GET /?url=ENCODED_URL → 200 + text/html con el HTML de la página.
 * Para Cloud Run: escala a cero cuando no hay peticiones (coste solo por uso).
 */

import http from "http";

const PORT = Number(process.env.PORT) || 8080;
const RENDER_TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS) || 45_000;

function getBrowser() {
  if (global.__browser) return global.__browser;
  throw new Error("Browser not initialized");
}

async function renderUrl(url) {
  const browser = getBrowser();
  const page = await browser.newPage();
  try {
    await page.setDefaultNavigationTimeout(RENDER_TIMEOUT_MS);
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    const response = await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: RENDER_TIMEOUT_MS,
    });
    if (response && response.status() >= 400) {
      const text = await page.content();
      return { html: text, status: response.status() };
    }
    const html = await page.content();
    return { html, status: 200 };
  } finally {
    await page.close().catch(() => {});
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("Method Not Allowed");
    return;
  }

  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const targetUrl = url.searchParams.get("url");
  if (!targetUrl) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Missing query parameter: url");
    return;
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Invalid url parameter");
    return;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("url must be http or https");
    return;
  }

  try {
    const { html, status } = await renderUrl(targetUrl);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Render error:", message);
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end(`Render failed: ${message}`);
  }
});

async function main() {
  const puppeteer = await import("puppeteer-core");
  const executablePath =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    process.env.CHROME_BIN ||
    "/usr/bin/chromium";
  global.__browser = await puppeteer.default.launch({
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--single-process",
      "--no-zygote",
      "--headless=new",
    ],
  });
  server.listen(PORT, () => {
    console.log(`Headless service listening on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
