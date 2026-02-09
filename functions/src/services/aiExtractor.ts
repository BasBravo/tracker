/**
 * Extracción mediante IA (Vertex AI Gemini o Gemini API).
 * - Criterios desde instrucción en lenguaje natural (una llamada por creación de tracking).
 * - Productos desde HTML como fallback cuando schema.org y heurísticas no devuelven resultados.
 * Modelo: Gemini 2.0 Flash (Vertex AI en GCP o Gemini API tier gratuito).
 */

import { parse } from "node-html-parser";
import type { Criteria, Product } from "../types";
import type { CriteriaMatch } from "./criteriaAnalyzer";

const LOG_PREFIX = "[AiExtractor]";

/** Score asignado a productos extraídos por IA (rango acotado). */
const AI_EXTRACTION_SCORE_MIN = 0.7;
const AI_EXTRACTION_SCORE_MAX = 0.85;

/** Máximo de caracteres de texto a enviar al modelo para controlar tokens. */
const MAX_INPUT_CHARS = 14_000;

/** Modelo Vertex AI. */
const VERTEX_MODEL = "gemini-2.0-flash-001";
/** Modelo Gemini API (Google AI Studio); nombre puede diferir de Vertex. */
const GEMINI_API_MODEL = "gemini-2.0-flash";

/** Estructura esperada en la respuesta JSON del modelo. */
interface AiProductRaw {
  name?: string;
  price?: number;
  currency?: string;
  size?: string;
  color?: string;
  url?: string;
  image?: string;
}

/**
 * Convierte HTML en texto plano para enviar al modelo (sin scripts, estilos; longitud limitada).
 */
export function htmlToPlainText(html: string, maxChars: number = MAX_INPUT_CHARS): string {
  const root = parse(html);
  root.querySelectorAll("script, style, noscript").forEach((el) => el.remove());
  const text = root.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return text.length <= maxChars ? text : text.slice(0, maxChars) + "...";
}

/**
 * Indica si el fallback por IA está disponible (Vertex o Gemini API key).
 */
export function isAiExtractionAvailable(): boolean {
  const project = process.env.PROJECT_ID;
  const location = process.env.VERTEX_AI_LOCATION;
  const apiKey = process.env.GEMINI_API_KEY;
  const disabled = process.env.GEMINI_EXTRACTION_ENABLED === "false";
  if (disabled) return false;
  return Boolean((project && location) || apiKey);
}

/**
 * Indica si la extracción de criterios desde instrucción (IA) está disponible.
 * Una llamada acotada por creación/actualización de tracking.
 */
export function isCriteriaExtractionAvailable(): boolean {
  const disabled = process.env.GEMINI_CRITERIA_EXTRACTION_ENABLED === "false";
  if (disabled) return false;
  return isAiExtractionAvailable();
}

/** Estructura esperada en la respuesta JSON de criterios. */
interface AiCriteriaRaw {
  priceMax?: number;
  priceMin?: number;
  size?: string;
  color?: string;
  productTypeHint?: string;
}

function buildCriteriaPrompt(instruction: string, pageUrl?: string): string {
  const urlContext = pageUrl ? `\nURL de la página que se rastreará: ${pageUrl}` : "";
  return `Eres un asistente que convierte instrucciones en lenguaje natural en criterios de búsqueda para un tracker de ofertas eCommerce.

Instrucción del usuario:
"${instruction}"
${urlContext}

Extrae y devuelve ÚNICAMENTE un JSON con estos campos (solo los que puedas inferir; omite los que no apliquen):
- priceMax: número (precio máximo en euros que el usuario está dispuesto a pagar).
- priceMin: número (precio mínimo razonable en euros). Infiérelo solo cuando el tipo de producto lo permita: si el usuario busca bicicletas, electrónica, portátiles, etc., indica un mínimo que evite falsos positivos (cuotas mensuales, números de modelo). Ej. bicicletas: 100, zapatillas: 15, portátiles: 200. No lo incluyas si el tipo de producto no está claro o si puede haber ofertas muy baratas válidas.
- size: string (talla deseada, ej. "S", "M", "L", "42").
- color: string (color deseado).
- productTypeHint: string (tipo de producto en una palabra o pocas, ej. "bicicletas", "zapatillas").

Responde solo con el JSON, sin markdown ni explicaciones. Si no hay ningún criterio claro, devuelve {}.
Ejemplo: {"priceMax":2000,"priceMin":100,"size":"L","productTypeHint":"bicicletas"}`;
}

function parseCriteriaResponse(rawText: string): Criteria {
  const trimmed = rawText.trim();
  const jsonStr = trimmed.replace(/^```json\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    console.warn(LOG_PREFIX, "Respuesta de IA (criterios) no es JSON válido", { preview: trimmed.slice(0, 200) });
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  const raw = parsed as AiCriteriaRaw;
  const criteria: Criteria = {};
  if (typeof raw.priceMax === "number" && raw.priceMax >= 0) criteria.priceMax = raw.priceMax;
  if (typeof raw.priceMin === "number" && raw.priceMin >= 0) criteria.priceMin = raw.priceMin;
  if (typeof raw.size === "string" && raw.size.trim()) criteria.size = raw.size.trim();
  if (typeof raw.color === "string" && raw.color.trim()) criteria.color = raw.color.trim();
  if (typeof raw.productTypeHint === "string" && raw.productTypeHint.trim()) {
    criteria.productTypeHint = raw.productTypeHint.trim();
  }
  return criteria;
}

/**
 * Extrae criterios estructurados a partir de una instrucción en lenguaje natural.
 * Una llamada por creación/actualización de tracking (uso acotado).
 *
 * @param instruction - Texto en lenguaje natural (ej. "Avísame cuando alguna bicicleta talla L baje de 2000 euros")
 * @param pageUrl - URL opcional de la página para contexto
 * @returns Criterios extraídos (priceMax, size, color, productTypeHint) o {} si falla o no hay proveedor
 */
export async function extractCriteriaFromInstruction(
  instruction: string,
  pageUrl?: string
): Promise<Criteria> {
  if (!isCriteriaExtractionAvailable()) {
    console.log(LOG_PREFIX, "Extracción de criterios por IA no disponible");
    return {};
  }
  const prompt = buildCriteriaPrompt(instruction, pageUrl);
  const projectId = process.env.PROJECT_ID;
  const location = process.env.VERTEX_AI_LOCATION;
  const apiKey = process.env.GEMINI_API_KEY;
  try {
    const rawText = await callAiWithRetryOn429(projectId, location, apiKey, prompt);
    const criteria = parseCriteriaResponse(rawText);
    console.log(LOG_PREFIX, "Criterios extraídos desde instrucción", { criteria });
    return criteria;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(LOG_PREFIX, "Error extrayendo criterios con IA", { error: message });
    return {};
  }
}

/** Máximo de productos a enviar al modelo en el filtro por tipo (control de tokens). */
const MAX_PRODUCTS_FOR_TYPE_FILTER = 150;

/**
 * Indica si el filtro por tipo de producto (IA) está disponible.
 */
export function isProductTypeFilterAvailable(): boolean {
  const disabled = process.env.GEMINI_PRODUCT_TYPE_FILTER_ENABLED === "false";
  if (disabled) return false;
  return isAiExtractionAvailable();
}

function buildProductTypeFilterPrompt(
  productSummaries: string[],
  productTypeHint: string,
  instruction?: string
): string {
  const instructionLine = instruction
    ? `Instrucción del usuario: "${instruction}"\n\n`
    : "";
  return `Eres un asistente que filtra productos por categoría/tipo. ${instructionLine}Tipo de producto que interesa: "${productTypeHint}".

A continuación se listan productos extraídos de una página (nombre | precio | URL). Algunos son del tipo indicado y otros son accesorios, componentes o productos de otra categoría que aparecen en la misma página.

Lista de productos (nombre | precio EUR | URL):
---
${productSummaries.join("\n")}
---

Devuelve ÚNICAMENTE un JSON array con las URLs exactas de los productos que SÍ corresponden al tipo "${productTypeHint}" (producto principal, no accesorios ni componentes sueltos). Si ninguno coincide, devuelve [].
Sin markdown, sin explicaciones. Ejemplo: ["https://example.com/bike-1","https://example.com/bike-2"]`;
}

function parseProductTypeFilterResponse(rawText: string): string[] {
  const trimmed = rawText.trim();
  const jsonStr = trimmed.replace(/^```json\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    console.warn(LOG_PREFIX, "Respuesta de IA (filtro tipo) no es JSON válido", { preview: trimmed.slice(0, 200) });
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const urls: string[] = [];
  for (const item of parsed) {
    if (typeof item === "string" && item.trim()) urls.push(item.trim());
  }
  return urls;
}

/**
 * Filtra productos por tipo usando IA: una llamada acotada por ejecución.
 * Solo conserva productos que la IA considera del tipo productTypeHint (p. ej. bicicletas y no pedales/sillines).
 *
 * @param products - Lista de productos extraídos (pueden ser bicis, componentes, etc.)
 * @param productTypeHint - Tipo deseado (ej. "bicicletas", "zapatillas")
 * @param instruction - Instrucción original del usuario (contexto opcional)
 * @returns Subconjunto de products que coinciden con el tipo; o todos si IA no disponible o falla
 */
export async function filterProductsByType<T extends Product>(
  products: T[],
  productTypeHint: string,
  instruction?: string
): Promise<T[]> {
  const hint = productTypeHint.trim();
  if (!hint || products.length === 0) return products;
  if (!isProductTypeFilterAvailable()) {
    console.log(LOG_PREFIX, "Filtro por tipo no disponible (IA desactivada o no configurada); se mantienen todos los productos");
    return products;
  }

  const toSend = products.slice(0, MAX_PRODUCTS_FOR_TYPE_FILTER);
  const summaries = toSend.map((p) => `${p.name} | ${p.price} ${p.currency} | ${p.url}`);
  const prompt = buildProductTypeFilterPrompt(summaries, hint, instruction);

  const projectId = process.env.PROJECT_ID;
  const location = process.env.VERTEX_AI_LOCATION;
  const apiKey = process.env.GEMINI_API_KEY;

  let rawText: string;
  try {
    rawText = await callAiWithRetryOn429(projectId, location, apiKey, prompt);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(LOG_PREFIX, "Error en filtro por tipo de producto", { error: message });
    return products;
  }

  const allowedUrls = new Set(parseProductTypeFilterResponse(rawText));
  if (allowedUrls.size === 0) {
    console.log(LOG_PREFIX, "IA no devolvió URLs para el tipo; se mantienen todos los productos");
    return products;
  }

  const filtered = products.filter((p) => allowedUrls.has(p.url));
  console.log(LOG_PREFIX, "Filtro por tipo aplicado", {
    productTypeHint: hint,
    total: products.length,
    kept: filtered.length,
  });
  return filtered;
}

/** Máximo de matches a enviar al modelo en el filtro de relevancia. */
const MAX_MATCHES_FOR_RELEVANCE_FILTER = 80;

/**
 * Indica si el filtro de relevancia (IA) está disponible.
 */
export function isRelevanceFilterAvailable(): boolean {
  const disabled = process.env.GEMINI_RELEVANCE_FILTER_ENABLED === "false";
  if (disabled) return false;
  return isAiExtractionAvailable();
}

function buildRelevanceFilterPrompt(
  matches: CriteriaMatch[],
  criteria: Criteria,
  instruction: string
): string {
  const criteriaStr = JSON.stringify(criteria);
  const lines = matches.map(
    (m, i) =>
      `${i + 1}. ${m.product.name} | ${m.product.price} ${m.product.currency} | talla: ${m.product.size ?? "—"} | ${m.product.url}`
  );
  return `Eres un asistente que filtra resultados de un tracker de ofertas. El usuario definió su búsqueda en lenguaje natural y el sistema ha encontrado candidatos; algunos son falsos positivos (precio erróneo, talla incorrecta, componente en vez de producto completo, etc.).

Instrucción del usuario: "${instruction}"
Criterios extraídos: ${criteriaStr}

Lista de candidatos (nombre | precio | talla | URL):
---
${lines.join("\n")}
---

Devuelve ÚNICAMENTE un JSON array con las URLs exactas de los productos que SÍ coinciden de verdad con lo que busca el usuario:
- Precio debe ser el precio real del producto (no una cuota mensual ni un número de modelo).
- Talla debe coincidir si el usuario la pidió (ej. si pide L, no incluir XL ni productos sin talla indicada).
- Debe ser el tipo de producto indicado (ej. bicicleta completa, no un componente o accesorio).
Si ninguno cumple de verdad, devuelve [].
Sin markdown, sin explicaciones. Ejemplo: ["https://example.com/product-1","https://example.com/product-2"]`;
}

function parseRelevanceFilterResponse(rawText: string): string[] {
  const trimmed = rawText.trim();
  const jsonStr = trimmed.replace(/^```json\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    console.warn(LOG_PREFIX, "Respuesta de IA (filtro relevancia) no es JSON válido", { preview: trimmed.slice(0, 200) });
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const urls: string[] = [];
  for (const item of parsed) {
    if (typeof item === "string" && item.trim()) urls.push(item.trim());
  }
  return urls;
}

/**
 * Filtra matches con IA para quedarse solo con los que realmente coinciden con la intención del usuario.
 * Elimina falsos positivos: precios erróneos (cuotas, números de modelo), tallas incorrectas, componentes vs producto completo.
 *
 * @param matches - Matches candidatos (ya pasaron criterios numéricos)
 * @param criteria - Criterios del tracking
 * @param instruction - Instrucción en lenguaje natural del usuario
 * @returns Subconjunto de matches que la IA considera realmente relevantes
 */
export async function filterMatchesByRelevance(
  matches: CriteriaMatch[],
  criteria: Criteria,
  instruction: string
): Promise<CriteriaMatch[]> {
  if (matches.length === 0) return [];
  if (!isRelevanceFilterAvailable()) {
    console.log(LOG_PREFIX, "Filtro de relevancia no disponible; se mantienen todos los matches");
    return matches;
  }

  const toSend = matches.slice(0, MAX_MATCHES_FOR_RELEVANCE_FILTER);
  const prompt = buildRelevanceFilterPrompt(toSend, criteria, instruction);

  const projectId = process.env.PROJECT_ID;
  const location = process.env.VERTEX_AI_LOCATION;
  const apiKey = process.env.GEMINI_API_KEY;

  let rawText: string;
  try {
    rawText = await callAiWithRetryOn429(projectId, location, apiKey, prompt);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(LOG_PREFIX, "Error en filtro de relevancia", { error: message });
    return matches;
  }

  const allowedUrls = new Set(parseRelevanceFilterResponse(rawText));
  if (allowedUrls.size === 0) {
    console.log(LOG_PREFIX, "IA no devolvió URLs en filtro de relevancia; se mantienen todos los matches");
    return matches;
  }

  const filtered = matches.filter((m) => allowedUrls.has(m.product.url));
  console.log(LOG_PREFIX, "Filtro de relevancia aplicado", {
    total: matches.length,
    kept: filtered.length,
  });
  return filtered;
}

/**
 * Genera el prompt de sistema y usuario para extracción de productos.
 */
function buildExtractionPrompt(pageText: string, pageUrl: string): string {
  return `Eres un asistente que extrae datos de productos desde el texto de una página de eCommerce.

Página (URL): ${pageUrl}

Texto extraído de la página (puede estar incompleto o con ruido):

---
${pageText}
---

Instrucciones:
- Extrae todos los productos que identifiques (nombre, precio, moneda, y si aparecen: talla, color, URL del producto, URL de imagen).
- Precio: usa ÚNICAMENTE el precio de venta actual del producto (el que se paga por el artículo), nunca el "ahorro" ni "Ahorra hasta X €" ni "Ahorras X €". Busca el precio principal (ej. "Desde 4.199 €", "2.499 €") y devuélvelo tal cual. No uses precio tachado, ni original, ni dígitos de códigos (ej. "810" en "RX810"). No inventes ni redondees: el número debe coincidir exactamente con lo que muestra la página. Si la moneda no se indica, usa "EUR".
- Talla: si en el texto del producto aparece disponibilidad por talla (ej. "Disponible para comprar en L", "Solo disponible en talla L", "talla L | XL"), extrae esa talla (o la primera si hay varias) en el campo size.
- Si solo hay un producto y no tiene URL propia, usa la URL de la página: "${pageUrl}".
- Responde ÚNICAMENTE con un JSON válido: un array de objetos. Sin markdown, sin explicaciones.
- Cada objeto debe tener: name (string), price (number), currency (string), url (string). Opcionales: size, color, image (strings).

Formato de respuesta (ejemplo):
[{"name":"Camiseta X","price":29.99,"currency":"EUR","url":"https://...","size":"M","color":"Negro"}, ...]`;
}

/**
 * Parsea la respuesta del modelo y devuelve productos normalizados.
 */
function parseAiResponse(
  rawText: string,
  pageUrl: string
): Array<Product & { confidenceScore: number }> {
  const trimmed = rawText.trim();
  const jsonStr = trimmed.replace(/^```json\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    console.warn(LOG_PREFIX, "Respuesta de IA no es JSON válido", { preview: trimmed.slice(0, 200) });
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.warn(LOG_PREFIX, "Respuesta de IA no es un array");
    return [];
  }

  const DEFAULT_CURRENCY = "EUR";
  const score = (AI_EXTRACTION_SCORE_MIN + AI_EXTRACTION_SCORE_MAX) / 2;

  const products: Array<Product & { confidenceScore: number }> = [];

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    if (!item || typeof item !== "object") continue;
    const raw = item as AiProductRaw;
    const price = typeof raw.price === "number" && raw.price >= 0 ? raw.price : null;
    if (price == null) continue;

    const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Producto";
    const currency =
      typeof raw.currency === "string" && raw.currency.trim() ? raw.currency.trim().toUpperCase() : DEFAULT_CURRENCY;
    const url =
      typeof raw.url === "string" && raw.url.trim()
        ? raw.url.trim()
        : `${pageUrl.replace(/#.*$/, "")}#product-${i}-${encodeURIComponent(name.slice(0, 30))}`;

    const product: Product & { confidenceScore: number } = {
      name,
      price,
      currency,
      url,
      confidenceScore: Math.round(score * 100) / 100,
    };
    if (typeof raw.size === "string" && raw.size.trim()) product.size = raw.size.trim();
    if (typeof raw.color === "string" && raw.color.trim()) product.color = raw.color.trim();
    if (typeof raw.image === "string" && raw.image.trim()) product.image = raw.image.trim();
    products.push(product);
  }

  return products;
}

/**
 * Llama a Vertex AI Gemini y devuelve el texto de la primera respuesta.
 */
async function generateWithVertex(
  projectId: string,
  location: string,
  prompt: string
): Promise<string> {
  const { VertexAI } = await import("@google-cloud/vertexai");
  const vertex = new VertexAI({ project: projectId, location });
  const model = vertex.getGenerativeModel({ model: VERTEX_MODEL });
  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
    },
  });

  const response = result.response;
  const candidate = response?.candidates?.[0];
  const part = candidate?.content?.parts?.[0];
  const text = part?.text;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Vertex AI no devolvió texto");
  }
  return text;
}

/**
 * Llama a la Gemini API (Google AI Studio) con API key y devuelve el texto.
 */
async function generateWithGeminiApi(apiKey: string, prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_API_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Gemini API no devolvió texto");
  }
  return text;
}

/** Espera N ms (para reintento tras 429). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Llama a Vertex o Gemini API; en 429 con Gemini API reintenta una vez tras 60 s.
 */
async function callAiWithRetryOn429(
  projectId: string | undefined,
  location: string | undefined,
  apiKey: string | undefined,
  prompt: string
): Promise<string> {
  if (projectId && location) {
    return generateWithVertex(projectId, location, prompt);
  }
  if (apiKey) {
    try {
      return await generateWithGeminiApi(apiKey, prompt);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if ((message.includes("429") || message.includes("quota")) && message.includes("Gemini API")) {
        console.warn(LOG_PREFIX, "429 recibido; reintento en 60 s...");
        await sleep(60_000);
        return generateWithGeminiApi(apiKey, prompt);
      }
      throw err;
    }
  }
  throw new Error("Ningún proveedor de IA configurado");
}

/**
 * Extrae productos del HTML usando IA (Vertex AI o Gemini API).
 * Solo debe llamarse cuando schema y heurísticas no han devuelto resultados.
 *
 * @param html - HTML de la página
 * @param pageUrl - URL de la página (para contexto y URLs relativas)
 * @returns Productos con confidence score en [0.7, 0.85], o [] si falla o no hay proveedor configurado
 */
export async function extractProductsWithAi(
  html: string,
  pageUrl: string
): Promise<Array<Product & { confidenceScore: number }>> {
  if (!isAiExtractionAvailable()) {
    console.log(LOG_PREFIX, "IA no disponible (sin Vertex ni GEMINI_API_KEY)");
    return [];
  }

  const pageText = htmlToPlainText(html);
  if (pageText.length < 50) {
    console.log(LOG_PREFIX, "Texto de página demasiado corto para IA");
    return [];
  }

  const prompt = buildExtractionPrompt(pageText, pageUrl);
  const projectId = process.env.PROJECT_ID;
  const location = process.env.VERTEX_AI_LOCATION;
  const apiKey = process.env.GEMINI_API_KEY;

  let rawText: string;
  try {
    rawText = await callAiWithRetryOn429(projectId, location, apiKey, prompt);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(LOG_PREFIX, "Error llamando al modelo", { error: message });
    if (message.includes("429") || message.toLowerCase().includes("quota")) {
      console.warn(
        LOG_PREFIX,
        "Cuota Gemini excedida. Opciones: usar Vertex AI (VERTEX_AI_LOCATION en .env), esperar antes de reintentar, o revisar plan en https://ai.google.dev"
      );
    }
    return [];
  }

  const products = parseAiResponse(rawText, pageUrl);
  console.log(LOG_PREFIX, "Productos extraídos por IA", { count: products.length });
  return products;
}
