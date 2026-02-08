/**
 * Script de prueba: POST a createTracking con datos de ejemplo (Canyon).
 * Muestra el trackingId generado.
 *
 * Uso:
 *   pnpm run build && node lib/scripts/testCanyon.js
 *   CREATE_TRACKING_URL=https://... node lib/scripts/testCanyon.js
 *
 * Reemplaza TU_EMAIL_AQUI@gmail.com por tu email o define CREATE_TRACKING_EMAIL.
 */

const CREATE_TRACKING_URL =
  process.env.CREATE_TRACKING_URL ??
  "https://europe-west3-zero-18081.cloudfunctions.net/createTracking";

const PAYLOAD = {
  url: "https://www.canyon.com/es-es/sale/",
  criteria: {
    priceMax: 1200,
    size: "L",
    color: null,
  },
  email: process.env.CREATE_TRACKING_EMAIL ?? "TU_EMAIL_AQUI@gmail.com",
  frequency: "hourly" as const,
  active: true,
};

interface CreateTrackingSuccess {
  id: string;
}

interface CreateTrackingError {
  error: string;
  details?: Record<string, string>;
  message?: string;
}

async function main(): Promise<void> {
  console.log("POST", CREATE_TRACKING_URL);
  console.log("Body:", JSON.stringify(PAYLOAD, null, 2));

  let response: Response;
  try {
    response = await fetch(CREATE_TRACKING_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(PAYLOAD),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Error de red:", message);
    process.exit(1);
  }

  let body: unknown;
  const rawText = await response.text();
  try {
    body = rawText ? JSON.parse(rawText) : {};
  } catch {
    console.error("Respuesta no JSON:", response.status, rawText);
    process.exit(1);
  }

  if (!response.ok) {
    const errorBody = body as CreateTrackingError;
    console.error(
      "createTracking falló:",
      response.status,
      errorBody.error ?? "Unknown error",
      errorBody.details ? JSON.stringify(errorBody.details) : "",
      errorBody.message ?? ""
    );
    process.exit(1);
  }

  const successBody = body as CreateTrackingSuccess;
  if (typeof successBody.id !== "string") {
    console.error("Respuesta sin id:", body);
    process.exit(1);
  }

  console.log("trackingId:", successBody.id);
}

main();
