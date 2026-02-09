# Tracker

Sistema de **tracking de ofertas eCommerce** con backend en **Firebase Functions** y **TypeScript**. Permite introducir una URL de cualquier página eCommerce, definir criterios (precio, talla, color, etc.) y recibir alertas por email cuando aparezcan productos u ofertas que coincidan.

---

## Arquitectura del sistema

```
                    ┌──────────────────────────────────────────────────────────────────┐
                    │                     Firebase / GCP                               │
  Usuario           │                                                                  │
     │              │   Cloud Scheduler (cron)                                         │
     │              │        │ hourly: scheduledTrackingCheck                          │
     │              │        │ */30 min: scheduledNotifications                        │
     ▼              │        ▼                                                         │
  Frontend ────────►│   Cloud Functions                                                │
  (API HTTP)        │        │                                                         │
                    │        ├── createTracking (POST) → Firestore trackings           │
                    │        ├── scheduledTrackingCheck                                │
                    │        │      │ fetch HTML → schema → heuristic → IA (Gemini)    │
                    │        │      └──► Firestore matches + update lastChecked        │
                    │        └── scheduledNotifications                                │
                    │              │ getUnnotifiedMatches → sendAlertEmail             │
                    │              └── markAsNotified                                  │
                    │                                                                  │
                    │   Firestore: trackings, matches                                  │
                    │   (opcional) SMTP → envío de emails                              │
                    └──────────────────────────────────────────────────────────────────┘
```

- **createTracking**: el cliente envía URL + instrucción en lenguaje natural + email; la IA extrae criterios y se guarda en Firestore.
- **scheduledTrackingCheck**: cada hora procesa trackings pendientes, descarga HTML, extrae productos (schema.org → heurísticas → **IA Gemini** si sigue vacío), aplica criterios, guarda matches y actualiza `lastChecked`.
- **scheduledNotifications**: cada 30 min agrupa matches no notificados por tracking, envía un email por grupo y marca como notificado.

---

## Setup inicial

### Requisitos

- **Node.js 18+**
- **npm** o pnpm
- Cuenta de **Google/Firebase**
- Proyecto en [Firebase Console](https://console.firebase.google.com)

### 1. Clonar e instalar dependencias

```bash
cd tracker
cd functions
npm install
```

### 2. Firebase CLI y proyecto

```bash
npm install -g firebase-tools
firebase login
```

En la **raíz del repo** (`tracker/`):

```bash
firebase use                    # ver proyecto actual
firebase use tu-project-id      # seleccionar proyecto
```

Si el proyecto no tiene Functions configuradas:

```bash
firebase init functions         # elegir TypeScript, ESLint si pregunta)
```

El `firebase.json` y `.firebaserc` ya deben existir; si no, `firebase init` los crea.

### 3. Variables de entorno (ver siguiente sección)

Copiar `functions/.env.example` a `functions/.env` y rellenar SMTP y, si aplica, proyecto.

### 4. Build y comprobación local

```bash
cd functions
npm run build
npm run serve                   # emulador de Functions (opcional)
```

---

## Configuración de variables de entorno

### En local (`functions/.env`)

Crear `functions/.env` a partir de `functions/.env.example`:

```bash
cd functions
cp .env.example .env
```

Variables usadas por el código:

| Variable       | Descripción                          | Ejemplo                 |
|----------------|--------------------------------------|-------------------------|
| `SMTP_HOST`    | Servidor SMTP                        | `smtp.gmail.com`        |
| `SMTP_PORT`    | Puerto (587 / 465)                   | `587`                   |
| `SMTP_SECURE`  | `true` para TLS (puerto 465)         | `false`                 |
| `SMTP_USER`    | Usuario SMTP                         | `tu-email@gmail.com`    |
| `SMTP_PASS`    | Contraseña o app password            | `***`                   |
| `FROM_EMAIL`   | Remitente de las alertas             | `tracker@midominio.com` |

**IA (extracción semántica, fallback cuando no hay schema ni heurísticas):**

| Variable                           | Descripción                                                                           | Ejemplo                   |
|------------------------------------|---------------------------------------------------------------------------------------|---------------------------|
| `VERTEX_AI_LOCATION`               | Región Vertex AI (mismo proyecto GCP). Si se define, se usa Vertex.                   | `europe-west1`            |
| `GEMINI_API_KEY`                   | (Opcional) API key de [Google AI Studio](https://aistudio.google.com). Tier gratuito. | `***`                     |
| `GEMINI_EXTRACTION_ENABLED`        | Desactivar fallback IA: `false`                                                       | `true` (por defecto)      |
| `GEMINI_RELEVANCE_FILTER_ENABLED`  | Desactivar filtro de relevancia sobre matches: `false` (por defecto activo). Reduce falsos positivos en el email. |
| `HEADLESS_FETCH_URL`               | (Opcional) URL base del servicio de renderizado (Puppeteer). Si está definida y una página devuelve anti-bot, se llama a este servicio para obtener el HTML. Ver sección "Sitios con protección anti-bot". | `https://tracker-headless-xxx.run.app` |

Sin `VERTEX_AI_LOCATION` ni `GEMINI_API_KEY`, el fallback por IA no se ejecuta. Ver [PLAN.md](./PLAN.md) para costes y detalles.

No subas `.env` al repositorio (está en `.gitignore`).

### Sitios con protección anti-bot (p. ej. Back Market)

Algunos sitios (como **Back Market**) devuelven un reto anti-bot cuando la petición no viene de un navegador real. En ese caso el sistema detecta la respuesta (JSON con `bot-need-challenge`), registra un error claro en los logs (`tracking_error` con `antibotChallenge: true`) y, si está configurado, **reintenta con un servicio headless** que renderiza la página con Puppeteer.

**Variable de entorno (opcional):**

| Variable               | Descripción                                                                 | Ejemplo                                      |
|------------------------|-----------------------------------------------------------------------------|----------------------------------------------|
| `HEADLESS_FETCH_URL`   | URL base del servicio de renderizado. Si existe, en caso de anti-bot se llama a `GET HEADLESS_FETCH_URL?url=ENCODED_URL` y se usa el HTML devuelto. | `https://headless-xxx.run.app`              |

**Servicio headless incluido (Cloud Run, escala a cero):**

En el repo hay un servicio listo para desplegar en **Google Cloud Run** (sin Chromium en las Functions, para no disparar costes ni tamaño del despliegue):

```bash
cd headless-service
npm install
gcloud run deploy tracker-headless \
  --source . \
  --region europe-west1 \
  --memory 1Gi \
  --timeout 60 \
  --no-allow-unauthenticated
```

Luego en **Firebase Console** → Functions → Variables de entorno, añade `HEADLESS_FETCH_URL` = `https://tracker-headless-XXXXX.run.app`. Si usas autenticación en Cloud Run, configura la cuenta de servicio de las Functions con permiso para invocar el servicio.

Detalles y alternativas en [headless-service/README.md](./headless-service/README.md).

**Otras opciones:** API oficial de Back Market ([doc.backmarket.io](https://doc.backmarket.io/)) si tienes acceso; o servicios de terceros (Browserless, ScrapingBee, etc.) que expongan una URL con query `url=`.

El cliente HTTP ya envía cabeceras tipo navegador (`User-Agent`, `Referer`, `sec-ch-ua`) para maximizar compatibilidad con el resto de sitios.

### En producción (Firebase)

Configurar en Firebase Console → Tu proyecto → **Functions** → **Configuración** → Variables de entorno, o con CLI:

```bash
firebase functions:config:set smtp.host="smtp.example.com" smtp.port="587" ...
```

Para que las Functions lean estas variables en producción, el código debe usar `functions.config()` o definir las mismas claves en **Variables de entorno** de la consola (por ejemplo `SMTP_HOST`, `SMTP_PORT`, etc.).

---

## Comandos de deploy

Desde la **raíz del proyecto** (`tracker/`) o desde `functions/`:

| Comando | Descripción |
|---------|-------------|
| `npm run deploy` | Despliega todas las Cloud Functions. |
| `npm run deploy:scheduler` | Igual que `deploy`: al desplegar functions, Firebase crea/actualiza los Cloud Scheduler asociados. |

Ejecución:

```bash
cd functions
npm run build          # compilar antes
npm run deploy         # firebase deploy --only functions
```

O desde la raíz:

```bash
firebase deploy --only functions
```

Tras el deploy, en la consola de Firebase aparecen las funciones (p. ej. `createTracking`, `scheduledTrackingCheck`, `scheduledNotifications`) y los jobs de Cloud Scheduler.

---

## Cómo probar el sistema

### 1. Tests unitarios (sin servicios externos)

```bash
cd functions
pnpm test
```

Ejecuta los tests de schema, heurísticas y criterios. No requiere Firestore ni IA.

### 2. Tests de integración (con emulador Firestore)

En un terminal, arranca el emulador:

```bash
firebase emulators:start --only firestore
```

En otro terminal:

```bash
cd functions
pnpm run test:integration
```

Comprueba el flujo completo: crear tracking → job de chequeo (HTML mockeado) → matches en Firestore → notificación (email mockeado).

### 3. Crear un tracking real (API)

Necesitas el proyecto desplegado o el emulador local.

**Opción A – Contra función desplegada**

Obtén la URL de `createTracking` en Firebase Console → Functions, o:

`https://europe-west3-TU_PROJECT_ID.cloudfunctions.net/createTracking`

```bash
curl -X POST "https://europe-west3-TU_PROJECT_ID.cloudfunctions.net/createTracking" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.canyon.com/es-es/sale/",
    "instruction": "Quiero que me avises cuando alguna bicicleta talla L baje de 2000 euros.",
    "email": "tu-email@ejemplo.com",
    "frequency": "daily",
    "active": true,
    "paginationLimit": 5
  }'
```

**Opción B – Script de prueba Canyon (recomendado la primera vez)**

El script ya envía `url` + `instruction` y usa tu `.env` (proyecto y opcionalmente IA):

```bash
cd functions
cp .env.example .env
# Edita .env: PROJECT_ID, y si quieres IA: GEMINI_API_KEY o VERTEX_AI_LOCATION
# Opcional: CREATE_TRACKING_EMAIL=tu@email.com
pnpm run test:canyon
```

Si la función está desplegada, por defecto hace POST a esa URL. Para apuntar a otra:

```bash
CREATE_TRACKING_URL=https://europe-west3-otro-proyecto.cloudfunctions.net/createTracking pnpm run test:canyon
```

La respuesta incluye el `trackingId` creado.

### 4. Ejecutar el chequeo de trackings a mano (run-jobs)

El scheduler en producción corre cada hora. Para probar sin esperar:

```bash
cd functions
# .env con PROJECT_ID del proyecto donde están los trackings
pnpm run run-jobs
```

Esto ejecuta `scheduledTrackingCheck` y `scheduledNotifications` contra Firestore real. Descarga las URLs de los trackings activos, extrae productos (schema → heurística → IA si está configurada), aplica criterios, guarda matches y envía emails si hay SMTP configurado.

### 5. Ver trackings en Firestore

```bash
cd functions
pnpm run list-trackings
```

Lista todos los trackings del proyecto (url, instruction, email, frequency, lastChecked). Útil para comprobar que `test:canyon` o el POST crearon el documento.

### 6. Resumen rápido

| Objetivo | Comando |
|----------|--------|
| Tests unitarios | `pnpm test` |
| Tests integración | Emulador Firestore + `pnpm run test:integration` |
| Crear tracking (Canyon) | Configurar `.env` y `pnpm run test:canyon` |
| Ejecutar jobs a mano | `pnpm run run-jobs` |
| Listar trackings | `pnpm run list-trackings` |

Para que la **IA** extraiga criterios de la instrucción y/o productos de la página, en `functions/.env` define **GEMINI_API_KEY** (o **VERTEX_AI_LOCATION** + proyecto con Vertex). Sin ello, la creación de tracking usará criterios vacíos `{}` y el chequeo no usará fallback IA para extraer productos.

---

## Ejemplos de uso de la API

### Base URL

Tras el deploy, la URL base es:

`https://REGION-PROJECT_ID.cloudfunctions.net`

(o la que indique la consola de Firebase para cada función).

### Crear un tracking (POST)

**Endpoint:** `POST /createTracking`
**Headers:** `Content-Type: application/json`
**CORS:** permitido (cabeceras configuradas en el handler).

**Body:**

```json
{
  "url": "https://www.canyon.com/es-es/sale/",
  "instruction": "Quiero que me avises cuando alguna de las bicicletas con talla L tenga un precio inferior a 2.000 euros.",
  "email": "usuario@ejemplo.com",
  "frequency": "daily",
  "active": true,
  "paginationLimit": 5
}
```

- **url** (obligatorio): URL http(s) de la página a rastrear.
- **instruction** (obligatorio): instrucción en lenguaje natural; la IA extrae criterios (precio máximo, talla, color, etc.).
- **email** (obligatorio): email donde recibir alertas.
- **frequency** (opcional): `"hourly"` \| `"daily"` \| `"weekly"` (por defecto `"daily"`).
- **active** (opcional): `true` \| `false` (por defecto `true`).
- **paginationLimit** (opcional): número de páginas a analizar por ejecución (1–20, por defecto 5).

**Ejemplo con curl:**

```bash
curl -X POST "https://REGION-PROJECT_ID.cloudfunctions.net/createTracking" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.canyon.com/es-es/sale/",
    "instruction": "Avísame cuando haya bicis talla L por menos de 2000 euros.",
    "email": "alerta@ejemplo.com",
    "frequency": "daily"
  }'
```

**Respuesta 201 (éxito):**

```json
{
  "id": "abc123xyz"
}
```

**Respuesta 400 (validación):**

```json
{
  "error": "Validation failed",
  "details": { "instruction": "La instrucción debe tener al menos 10 caracteres" }
}
```

**Respuesta 405:** método no permitido (solo POST).
**Respuesta 500:** error interno (p. ej. Firestore).

---

## Estructura del proyecto

```
tracker/
├── .firebaserc              # Proyecto Firebase por defecto
├── firebase.json            # Configuración (functions, predeploy)
├── .gitignore
├── PLAN.md                  # Plan técnico detallado
├── README.md                # Este archivo
│
└── functions/
    ├── .env                 # Variables locales (no commitear)
    ├── .env.example         # Plantilla de variables
    ├── .eslintrc.js         # Config ESLint
    ├── jest.config.js       # Config Jest (tests + coverage)
    ├── package.json
    ├── tsconfig.json
    ├── lib/                 # Salida de `npm run build` (generado)
    │
    └── src/
        ├── index.ts         # Entrada: exporta funciones y HTTP
        ├── types/           # Interfaces (TrackingConfig, Product, Match, Criteria…)
        ├── handlers/        # Handlers HTTP (CORS, createTracking)
        ├── jobs/            # Lógica de jobs programados (tracking check, notifications)
        ├── services/        # Lógica de negocio
        │   ├── httpClient.ts
        │   ├── schemaExtractor.ts
        │   ├── heuristicParser.ts
        │   ├── criteriaAnalyzer.ts
        │   ├── trackingRepository.ts
        │   ├── matchRepository.ts
        │   └── emailService.ts
        ├── utils/           # Validadores (Zod), sanitización
        └── __tests__/       # Tests (Jest)
            ├── fixtures/    # HTML mocks (schema.org, etc.)
            ├── schemaExtractor.test.ts
            ├── criteriaAnalyzer.test.ts
            ├── heuristicParser.test.ts
            └── integration.test.ts
```

---

## Scripts disponibles (functions)

| Script | Comando | Descripción |
|--------|---------|-------------|
| `build` | `tsc` | Compila TypeScript a `lib/`. |
| `build:watch` | `tsc --watch` | Compilación en modo watch. |
| `test` | `jest` | Ejecuta tests unitarios. |
| `test:coverage` | `jest --coverage` | Tests con reporte de cobertura. |
| `test:integration` | `RUN_INTEGRATION_TESTS=1 jest …` | Tests de integración (emulador Firestore). |
| `lint` | `eslint src --ext .ts` | Lint del código TypeScript. |
| `deploy` | `firebase deploy --only functions` | Despliega Cloud Functions. |
| `deploy:scheduler` | `firebase deploy --only functions` | Despliega functions (y actualiza schedulers). |
| `serve` | build + emulators | Emulador local de Functions. |
| `logs` | `firebase functions:log` | Ver logs de las funciones. |

---

## Troubleshooting común

### "Permission denied" o 403 al desplegar

- Comprueba que estás logueado: `firebase login`.
- Comprueba que el proyecto es el correcto: `firebase use` y que tu cuenta tenga permisos de *Editor* o *Owner* en el proyecto.

### Las funciones programadas no se ejecutan

- Tras `deploy`, los jobs de Cloud Scheduler se crean/actualizan automáticamente. Revisa en **Google Cloud Console** → **Cloud Scheduler** que existan los jobs y no estén pausados.
- Revisa la zona horaria en el código (`timeZone: "Europe/Madrid"`) y que la región del Scheduler coincida con la de las Functions.

### No llegan los emails

- Revisa en **Firebase Console** → **Functions** → **Logs** que no haya errores en `scheduledNotifications` o en el servicio de email.
- Comprueba que las variables de entorno de SMTP estén bien configuradas en producción (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `FROM_EMAIL`).
- En Gmail usa una *contraseña de aplicación*, no la contraseña normal.

### Error "FIRESTORE_EMULATOR_HOST" en tests

- Los tests de integración requieren el emulador: `firebase emulators:start --only firestore`.
- Ejecuta los tests de integración con: `npm run test:integration` (usa `RUN_INTEGRATION_TESTS=1`).

### Build falla con errores de TypeScript

- Ejecuta `npm run build` dentro de `functions/`.
- Si faltan tipos: `npm install` y comprueba que `tsconfig.json` incluye los archivos correctos (por defecto `src/`).

### CORS en createTracking

- El handler ya envía cabeceras CORS y responde a `OPTIONS`. Si usas un frontend en otro dominio, asegúrate de que la URL de la función sea la correcta y que no haya un proxy que quite las cabeceras.

---

## Documentación adicional

- **[PLAN.md](./PLAN.md)** — Plan técnico: modelo de datos Firestore, pipeline de análisis, fases de desarrollo y principios de diseño.
