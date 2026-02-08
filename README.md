# Tracker

Sistema de **tracking de ofertas eCommerce** con backend en **Firebase Functions** y **TypeScript**. Permite introducir una URL de cualquier página eCommerce, definir criterios (precio, talla, color, etc.) y recibir alertas por email cuando aparezcan productos u ofertas que coincidan.

---

## Arquitectura del sistema

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                     Firebase / GCP                        │
  Usuario           │                                                           │
     │              │   Cloud Scheduler (cron)                                  │
     │              │        │ hourly: scheduledTrackingCheck                   │
     │              │        │ */30 min: scheduledNotifications                 │
     ▼              │        ▼                                                   │
  Frontend ────────►│   Cloud Functions                                          │
  (API HTTP)        │        │                                                    │
                    │        ├── createTracking (POST) → Firestore trackings     │
                    │        ├── scheduledTrackingCheck                          │
                    │        │      │ fetch HTML → schema/heuristic → criteria   │
                    │        │      └──► Firestore matches + update lastChecked  │
                    │        └── scheduledNotifications                           │
                    │              │ getUnnotifiedMatches → sendAlertEmail       │
                    │              └── markAsNotified                             │
                    │                                                             │
                    │   Firestore: trackings, matches                            │
                    │   (opcional) SMTP → envío de emails                        │
                    └─────────────────────────────────────────────────────────┘
```

- **createTracking**: el cliente envía URL + criterios + email; se guarda en Firestore.
- **scheduledTrackingCheck**: cada hora procesa trackings pendientes, descarga HTML, extrae productos (schema.org o heurísticas), aplica criterios, guarda matches y actualiza `lastChecked`.
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

| Variable       | Descripción                          | Ejemplo              |
|----------------|--------------------------------------|----------------------|
| `SMTP_HOST`    | Servidor SMTP                        | `smtp.gmail.com`     |
| `SMTP_PORT`    | Puerto (587 / 465)                   | `587`                |
| `SMTP_SECURE`  | `true` para TLS (puerto 465)         | `false`              |
| `SMTP_USER`    | Usuario SMTP                         | `tu-email@gmail.com` |
| `SMTP_PASS`    | Contraseña o app password             | `***`                |
| `FROM_EMAIL`   | Remitente de las alertas             | `tracker@midominio.com` |

No subas `.env` al repositorio (está en `.gitignore`).

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
  "url": "https://example.com/ofertas-camiseta",
  "email": "usuario@ejemplo.com",
  "criteria": {
    "priceMax": 80,
    "size": "L",
    "color": "negro"
  },
  "frequency": "daily",
  "active": true
}
```

- **url** (obligatorio): URL http(s) de la página a rastrear.  
- **email** (obligatorio): email donde recibir alertas.  
- **criteria** (opcional): `priceMax` (número), `size`, `color` (strings).  
- **frequency** (opcional): `"hourly"` \| `"daily"` \| `"weekly"` (por defecto `"daily"`).  
- **active** (opcional): `true` \| `false` (por defecto `true`).

**Ejemplo con curl:**

```bash
curl -X POST "https://REGION-PROJECT_ID.cloudfunctions.net/createTracking" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/producto",
    "email": "alerta@ejemplo.com",
    "criteria": { "priceMax": 50, "size": "M", "color": "azul" },
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
  "details": { "url": "Debe ser una URL válida (http o https)" }
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
