# Servicio headless para el Tracker

Servicio HTTP que renderiza una URL con **Puppeteer** (Chromium) y devuelve el HTML. Pensado para sitios con protección anti-bot (p. ej. Back Market). Se despliega por separado en **Cloud Run** y escala a cero, así que solo consumes recursos cuando el job de tracking lo usa.

## Contrato

- **GET** `/?url=ENCODED_TARGET_URL` → responde **200** con `text/html` = HTML renderizado de esa URL.
- Si falta `url` o no es http(s): **400**.
- Si el render falla (timeout, error): **502**.

## Requisitos

- Node.js 20+
- Chromium instalado en el sistema (en Docker se instala en la imagen).

## Despliegue en Google Cloud Run

1. Instala [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) y haz `gcloud auth login` y `gcloud config set project TU_PROJECT_ID`.

2. Desde esta carpeta:

```bash
npm install
gcloud run deploy tracker-headless \
  --source . \
  --region europe-west1 \
  --memory 1Gi \
  --timeout 60 \
  --no-allow-unauthenticated
```

- **1Gi** de memoria es lo habitual para Chromium.
- **timeout 60** segundos para dar tiempo al render.
- **--no-allow-unauthenticated**: solo las Cloud Functions (o lo que tú configures) podrán llamar al servicio. Si prefieres público, quita esa opción.

3. Anota la URL del servicio (ej. `https://tracker-headless-xxxxx-ew.a.run.app`).

4. En **Firebase Console** → Tu proyecto → **Functions** → Configuración → Variables de entorno, añade:

   - `HEADLESS_FETCH_URL` = URL del servicio (sin `/` final), ej. `https://tracker-headless-xxxxx-ew.a.run.app`

5. Si desplegaste con `--no-allow-unauthenticated`, la cuenta de servicio de las Cloud Functions debe tener el rol **Cloud Run Invoker** en ese servicio. El tracker envía automáticamente un token de identidad cuando `HEADLESS_FETCH_URL` es una URL `*.run.app`.

## Coste

Cloud Run factura por uso (CPU/memoria × tiempo). Con escala a cero, si no hay trackings que disparen headless (p. ej. solo Back Market una vez a la hora), el coste es bajo. Consulta [precios de Cloud Run](https://cloud.google.com/run/pricing).

## Variables de entorno del servicio

| Variable                    | Descripción                          | Por defecto |
|----------------------------|--------------------------------------|-------------|
| `PORT`                     | Puerto HTTP                          | 8080        |
| `RENDER_TIMEOUT_MS`        | Timeout del navegador por página (ms) | 45000     |
| `PUPPETEER_EXECUTABLE_PATH`| Ruta de Chromium (en Docker: `/usr/bin/chromium`) | — |

## Alternativas

- **Browserless.io** u otros SaaS: si ofrecen un endpoint tipo `GET https://...?url=...`, puedes usar esa URL como `HEADLESS_FETCH_URL`.
- **Otra región**: cambia `--region` en `gcloud run deploy` según tu preferencia.
