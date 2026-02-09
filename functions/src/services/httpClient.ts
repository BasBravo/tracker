/**
 * Cliente HTTP para descarga de HTML.
 * Retry, timeout, User-Agent realista, rate limiting básico y manejo de errores.
 */

import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios";
import { GoogleAuth } from "google-auth-library";

/** Timeout por solicitud (ms). */
const REQUEST_TIMEOUT_MS = 30_000;

/** Número máximo de reintentos (incluyendo el primer intento). */
const MAX_RETRIES = 3;

/** Espera mínima entre reintentos (ms). */
const RETRY_DELAY_MS = 1_000;

/** Intervalo mínimo entre peticiones al mismo host (rate limiting) en ms. */
const MIN_INTERVAL_PER_HOST_MS = 1_000;

/** User-Agent de navegador realista (Chrome en Windows). */
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Código de error cuando el sitio devuelve un reto anti-bot (p. ej. Back Market). */
export const FETCH_ERROR_ANTIBOT = "ANTIBOT_CHALLENGE";

/** Última vez que se hizo una petición por host (para rate limiting). */
const lastRequestByHost = new Map<string, number>();

/**
 * Obtiene el host de una URL para usar como clave de rate limiting.
 */
function getHostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Respeta un intervalo mínimo entre peticiones al mismo host.
 */
async function rateLimit(host: string): Promise<void> {
  const now = Date.now();
  const last = lastRequestByHost.get(host) ?? 0;
  const elapsed = now - last;
  if (elapsed < MIN_INTERVAL_PER_HOST_MS) {
    await sleep(MIN_INTERVAL_PER_HOST_MS - elapsed);
  }
  lastRequestByHost.set(host, Date.now());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Indica si el error es recuperable con un reintento (red, timeout, 5xx).
 */
function isRetryableError(error: AxiosError): boolean {
  if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") return true;
  if (error.code === "ECONNRESET" || error.code === "ENOTFOUND") return true;
  const status = error.response?.status;
  if (status != null && status >= 500 && status < 600) return true;
  if (status === 429) return true; // Too Many Requests
  return false;
}

/**
 * Cabeceras adicionales tipo navegador para reducir detección como bot (compatibles con cualquier sitio).
 */
function getBrowserLikeHeaders(url: string): Record<string, string> {
  try {
    const origin = new URL(url).origin + "/";
    return {
      Referer: origin,
      "sec-ch-ua": '"Chromium";v="120", "Google Chrome";v="120", "Not_A Brand";v="24"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
    };
  } catch {
    return {};
  }
}

/**
 * Detecta si el cuerpo de la respuesta es un reto anti-bot (p. ej. Back Market devuelve JSON con bot-need-challenge).
 */
function isAntibotChallengeResponse(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed.length > 2000 || !trimmed.startsWith("{")) return false;
  try {
    const data = JSON.parse(trimmed) as { errors?: Array<{ code?: string }> };
    const code = data?.errors?.[0]?.code;
    return code === "bot-need-challenge" || code === "challenge_required";
  } catch {
    return false;
  }
}

/**
 * Crea una instancia de axios configurada para scraping de HTML.
 */
function createClient(userAgent: string = DEFAULT_USER_AGENT): AxiosInstance {
  return axios.create({
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      "User-Agent": userAgent,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    },
    maxRedirects: 5,
    validateStatus: (status: number) => status >= 200 && status < 400,
  });
}

const defaultClient = createClient();

export interface FetchHtmlResult {
  /** HTML descargado. */
  html: string;
  /** URL final (tras redirecciones). */
  finalUrl: string;
  /** Código de estado HTTP. */
  status: number;
}

export interface FetchHtmlErrorDetails {
  /** Mensaje legible. */
  message: string;
  /** Código de error (axios o HTTP). */
  code?: string;
  /** Status HTTP si hubo respuesta. */
  status?: number;
  /** Si se agotaron los reintentos. */
  retriesExhausted: boolean;
}

/** Error lanzado cuando falla la descarga de HTML (tras reintentos). */
export class FetchHtmlError extends Error implements FetchHtmlErrorDetails {
  code?: string;
  status?: number;
  retriesExhausted: boolean;

  constructor(details: FetchHtmlErrorDetails) {
    super(details.message);
    this.name = "FetchHtmlError";
    this.code = details.code;
    this.status = details.status;
    this.retriesExhausted = details.retriesExhausted;
    Object.setPrototypeOf(this, FetchHtmlError.prototype);
  }
}

/**
 * Descarga el HTML de una URL con retry, timeout y rate limiting.
 *
 * @param url - URL a descargar (debe ser http o https)
 * @param options - Opciones opcionales (User-Agent, timeout, cliente custom)
 * @returns HTML, URL final y status, o lanza FetchHtmlError
 */
export async function fetchHtml(
  url: string,
  options: {
    userAgent?: string;
    timeoutMs?: number;
    client?: AxiosInstance;
  } = {}
): Promise<FetchHtmlResult> {
  const client = options.client ?? defaultClient;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const host = getHostFromUrl(url);

  let lastError: AxiosError | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    await rateLimit(host);

    try {
      const config: AxiosRequestConfig = {
        url,
        method: "GET",
        timeout: timeoutMs,
        responseType: "text",
        headers: getBrowserLikeHeaders(url),
      };

      const response = await client.request<string>(config);
      const html = response.data;

      if (typeof html !== "string") {
        throw new Error("La respuesta no es texto");
      }

      if (isAntibotChallengeResponse(html)) {
        throw new FetchHtmlError({
          message:
            "El sitio devolvió un reto anti-bot (p. ej. Back Market). No se puede extraer HTML. Opciones: usar navegador headless (Puppeteer/Playwright) o la API oficial del sitio si está disponible.",
          code: FETCH_ERROR_ANTIBOT,
          status: response.status,
          retriesExhausted: false,
        });
      }

      const finalUrl =
        (response.request as { responseUrl?: string } | undefined)?.responseUrl ??
        response.config.url ??
        url;

      return {
        html,
        finalUrl,
        status: response.status,
      };
    } catch (err) {
      if (err instanceof FetchHtmlError) {
        throw err;
      }
      lastError = err instanceof AxiosError ? err : new AxiosError(String(err));

      const retryable = isRetryableError(lastError);
      const hasMoreAttempts = attempt < MAX_RETRIES;

      if (!retryable || !hasMoreAttempts) {
        break;
      }

      const delay = RETRY_DELAY_MS * attempt;
      await sleep(delay);
    }
  }

  const status = lastError?.response?.status;
  const code = lastError?.code ?? (lastError?.response?.data as { code?: string } | undefined)?.code;
  const message =
    lastError?.response?.data != null && typeof lastError.response.data === "string"
      ? lastError.response.data.slice(0, 200)
      : lastError?.message ?? "Error desconocido al descargar la URL";

  throw new FetchHtmlError({
    message: `No se pudo descargar la URL: ${message}`,
    code: code as string | undefined,
    status,
    retriesExhausted: true,
  });
}

/** Timeout por defecto para headless (renderizado puede tardar). */
const HEADLESS_FETCH_TIMEOUT_MS = 60_000;

/**
 * Obtiene el HTML de una URL usando un servicio externo de renderizado (Puppeteer/Playwright).
 * Pensado para cuando fetchHtml falla por anti-bot. No incluye Chromium en este paquete.
 *
 * @param targetUrl - URL de la página a renderizar
 * @param headlessServiceUrl - URL base del servicio (ej. https://headless-xxx.run.app). Se llama GET con query url=
 * @param options - timeout opcional
 * @returns HTML, URL final y status
 */
/**
 * Indica si la URL parece ser un servicio Cloud Run (requiere token de identidad si es privado).
 */
function isCloudRunUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname.endsWith(".run.app");
  } catch {
    return false;
  }
}

export async function fetchHtmlHeadless(
  targetUrl: string,
  headlessServiceUrl: string,
  options: { timeoutMs?: number } = {}
): Promise<FetchHtmlResult> {
  const base = headlessServiceUrl.replace(/\/$/, "");
  const separator = base.includes("?") ? "&" : "?";
  const serviceUrl = `${base}${separator}url=${encodeURIComponent(targetUrl)}`;
  const timeoutMs = options.timeoutMs ?? HEADLESS_FETCH_TIMEOUT_MS;

  let html: string;
  let status: number;

  if (isCloudRunUrl(base)) {
    const auth = new GoogleAuth();
    const client = await auth.getIdTokenClient(base);
    const res = await client.request<string>({
      url: serviceUrl,
      method: "GET",
      responseType: "text",
      timeout: timeoutMs,
    });
    html = typeof res.data === "string" ? res.data : "";
    status = res.status ?? 200;
  } else {
    const config: AxiosRequestConfig = {
      url: serviceUrl,
      method: "GET",
      timeout: timeoutMs,
      responseType: "text",
      validateStatus: (s: number) => s === 200,
    };
    const response = await defaultClient.request<string>(config);
    html = response.data;
    status = response.status;
  }

  if (status !== 200) {
    throw new FetchHtmlError({
      message: `Servicio headless devolvió ${status}`,
      status,
      retriesExhausted: false,
    });
  }

  if (typeof html !== "string") {
    throw new FetchHtmlError({
      message: "El servicio headless no devolvió texto",
      retriesExhausted: false,
    });
  }

  if (isAntibotChallengeResponse(html)) {
    throw new FetchHtmlError({
      message: "El sitio siguió devolviendo anti-bot tras renderizado headless",
      code: FETCH_ERROR_ANTIBOT,
      status: 200,
      retriesExhausted: false,
    });
  }

  return {
    html,
    finalUrl: targetUrl,
    status,
  };
}

/**
 * Indica si está configurado un servicio headless (solo comprueba que exista la variable).
 */
export function isHeadlessFetchAvailable(): boolean {
  const url = process.env.HEADLESS_FETCH_URL;
  return typeof url === "string" && url.trim().length > 0;
}
