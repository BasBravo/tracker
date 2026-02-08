/**
 * Cliente HTTP para descarga de HTML.
 * Retry, timeout, User-Agent realista, rate limiting básico y manejo de errores.
 */

import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios";

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
      };

      const response = await client.request<string>(config);
      const html = response.data;

      if (typeof html !== "string") {
        throw new Error("La respuesta no es texto");
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
