/**
 * CORS para funciones HTTP.
 * Añade cabeceras y responde a OPTIONS (preflight).
 */

import type * as functions from "firebase-functions";

const DEFAULT_ORIGIN = "*";
const DEFAULT_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
const DEFAULT_HEADERS = "Content-Type, Authorization";

export type HttpHandler = (
  req: functions.https.Request,
  res: functions.Response
) => void | Promise<void>;

/**
 * Opciones de CORS.
 */
export interface CorsOptions {
  origin?: string;
  methods?: string;
  allowedHeaders?: string;
  maxAge?: number;
}

/**
 * Envuelve un handler HTTP para añadir CORS.
 * Responde 204 a OPTIONS y delega en el handler para el resto.
 */
export function withCors(
  handler: HttpHandler,
  options: CorsOptions = {}
): HttpHandler {
  const origin = options.origin ?? DEFAULT_ORIGIN;
  const methods = options.methods ?? DEFAULT_METHODS;
  const allowedHeaders = options.allowedHeaders ?? DEFAULT_HEADERS;
  const maxAge = options.maxAge ?? 86400;

  return (req: functions.https.Request, res: functions.Response) => {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Access-Control-Allow-Methods", methods);
    res.set("Access-Control-Allow-Headers", allowedHeaders);
    res.set("Access-Control-Max-Age", String(maxAge));

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    return handler(req, res);
  };
}
