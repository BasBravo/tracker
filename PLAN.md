# Plan técnico – Sistema de tracking de ofertas eCommerce (IA como protagonista)

## Objetivo

Construir un sistema en el que el usuario introduce **una instrucción en lenguaje natural** y **una URL**. El sistema utiliza IA para interpretar la instrucción, extraer criterios estructurados y, combinando IA con métodos eficientes ya existentes, analizar la página (y sus páginas siguientes si hay paginación) para detectar productos que cumplan el criterio y enviar alertas por email.

**Ejemplo de uso:**

- **URL:** `https://www.canyon.com/es-es/sale/`
- **Instrucción:** *"Quiero que me avises cuando alguna de las bicicletas con talla L tenga un precio inferior a 2.000 euros."*

El endpoint de tracking debe ser capaz de, a partir de esa instrucción y URL, extraer con IA los datos necesarios para la búsqueda, estructurarlos y ejecutar el análisis de la página de forma acotada en coste y peticiones.

El sistema debe ser:

- **Centrado en la instrucción en lenguaje natural** (la IA es la protagonista del tracking)
- Tolerante a layouts y sitios distintos
- Escalable y con **uso de IA muy acotado** (evitar exceso de peticiones y costes)
- Desplegado en Firebase Cloud Functions

---

## Alcance funcional (MVP)

**Incluido:**

- Endpoint de tracking con input: **instrucción en lenguaje natural** + **URL**
- Extracción de criterios estructurados a partir de la instrucción mediante IA (una llamada acotada por creación/actualización de tracking)
- Descarga y parseo de la página de destino (schema.org, heurísticas, IA como refuerzo) para capturar productos que coincidan con el criterio
- Soporte de **paginación**: cargar y analizar páginas siguientes cuando la página de resultados esté paginada
- Evaluación de coincidencias (precio, talla, color, etc.) según criterios extraídos
- Alertas por email
- Ejecución periódica mediante scheduler

**No incluido en el MVP:**

- Autenticación avanzada
- Historial de precios
- Comparación entre tiendas
- Scraping autenticado
- OCR de imágenes

---

## Arquitectura general

```
Usuario
  → Frontend (URL + instrucción en lenguaje natural)
  → Endpoint de tracking (API)
  → IA: instrucción → criterios estructurados (una llamada acotada)
  → Firestore (configuración de tracking: url, criteria, email, etc.)
  → Cloud Scheduler
  → Cloud Functions (descarga HTML, parseo eficiente + IA acotada, paginación)
  → Firestore (resultados / matches)
  → Servicio de email
```

---

## Principios de diseño

1. **Instrucción como entrada única de criterios**
   El usuario no rellena formularios de criterios; escribe qué quiere en lenguaje natural. La IA traduce esa instrucción a una estructura de criterios (precio máximo, talla, color, tipo de producto, etc.).

2. **IA acotada**
   - **Creación/actualización de tracking:** una llamada a IA para convertir instrucción → criterios estructurados.
   - **Análisis de página:** priorizar schema.org y heurísticas; usar IA solo cuando sea necesario y con límites (p. ej. un número máximo de fragmentos o de productos a enviar a IA por ejecución).

3. **Paginación explícita**
   Si la página de resultados tiene paginado, el sistema debe detectarlo, cargar las siguientes páginas y seguir analizando resultados hasta un límite configurable (p. ej. máximo N páginas por ejecución) para no disparar costes.

4. **Confianza explícita**
   Cada match incluye un score cuando la extracción es semántica o heurística.

5. **Idempotencia donde sea posible**
   Misma URL + misma instrucción deben producir los mismos criterios estructurados; el análisis de la página puede variar por contenido dinámico, pero el flujo y los límites deben ser reproducibles.

---

## Modelo de datos (Firestore)

### Collection: trackings

```json
{
  "url": "https://www.canyon.com/es-es/sale/",
  "instruction": "Quiero que me avises cuando alguna de las bicicletas con talla L tenga un precio inferior a 2.000 euros.",
  "criteria": {
    "priceMax": 2000,
    "size": "L",
    "productTypeHint": "bicicletas"
  },
  "email": "user@email.com",
  "frequency": "daily",
  "active": true,
  "lastChecked": "timestamp",
  "paginationLimit": 5
}
```

- `instruction`: texto original del usuario (fuente de verdad para re-extraer criterios si se desea).
- `criteria`: estructura generada por IA a partir de `instruction`; es la que se usa para filtrar productos.
- `paginationLimit`: (opcional) número máximo de páginas a analizar por ejecución para controlar costes.

### Collection: matches

```json
{
  "trackingId": "ref",
  "product": {
    "name": "Producto",
    "price": 899,
    "currency": "EUR",
    "size": "L",
    "color": "negro",
    "url": "https://..."
  },
  "confidenceScore": 0.92,
  "detectedAt": "timestamp"
}
```

Sin cambios respecto al comportamiento actual de matches.

---

## Pipeline de análisis

### 1. Entrada del usuario (endpoint de tracking)

- Input: **URL** + **instrucción en lenguaje natural**.
- Una llamada a IA (acotada) para convertir la instrucción en **criterios estructurados** (precio máximo/mínimo, talla, color, tipo de producto, etc.).
- Validación y normalización de criterios.
- Persistencia en Firestore: `url`, `instruction`, `criteria`, `email`, `frequency`, `active`, `paginationLimit`, etc.

### 2. Ejecución periódica (scheduler)

Para cada tracking activo:

1. **Descarga del HTML** de la URL del tracking (página de resultados).
2. **Extracción de productos** en este orden:
   - Schema.org (JSON-LD) si existe.
   - Heurísticas (selectores CSS, patrones de precio, estructura conocida).
   - IA como refuerzo solo si hace falta y con límite (p. ej. un único fragmento resumido de la página o un subconjunto de productos) para no disparar costes.
3. **Paginación:** si se detecta que la página tiene “siguiente página” (enlaces, parámetros, etc.), cargar hasta `paginationLimit` páginas adicionales y repetir extracción en cada una, acumulando productos sin duplicados.
4. **Normalización** de productos (precio, talla, color, URL).
5. **Filtro por tipo de producto (opcional):** si `criteria.productTypeHint` está definido (p. ej. "bicicletas"), una llamada a IA acotada filtra la lista para quedarse solo con productos que corresponden a ese tipo (y excluir accesorios/componentes de otra categoría que aparezcan en la misma página). Así se evitan alertas por productos no deseados (ej. pedales o sillines cuando el usuario pidió bicicletas).
6. **Evaluación de criterios** sobre los productos (precio ≤ X, talla = L, etc.).
7. **Generación de matches** con score y persistencia.
8. **Notificación por email** cuando haya nuevos matches según la lógica actual.

---

## IA en el sistema (uso acotado)

La IA es la **protagonista** en la interpretación de la intención del usuario, pero su uso debe estar **muy acotado** para controlar peticiones y costes.

### Tres puntos de uso de IA

| Momento | Uso | Acotación |
|--------|-----|-----------|
| **Creación/actualización de tracking** | Una llamada para: instrucción → criterios estructurados (JSON). | 1 llamada por creación/actualización. Prompt fijo, respuesta acotada (solo criterios). |
| **Filtro por tipo de producto** | Si `productTypeHint` está en criterios: una llamada que recibe la lista de productos (nombre, precio, URL) y devuelve solo las URLs que corresponden al tipo (p. ej. bicicletas y no accesorios). | 1 llamada por tracking por ejecución, solo cuando hay productTypeHint. Lista acotada (ej. 150 productos). Compatible con cualquier e-commerce y cualquier tipología. |
| **Análisis de página** | Solo si schema y heurísticas no devuelven productos suficientes o la página es atípica. | Límite por ejecución: p. ej. 1 llamada por run del job, o un máximo de tokens/fragmento. No enviar HTML completo sin control. |

### Modelo y proveedor

- **Vertex AI (GCP)** con **Gemini 2.0 Flash** (mismo proyecto que Firebase).
- **Alternativa:** **Gemini API** (Google AI Studio) con `GEMINI_API_KEY` para desarrollo o bajo volumen.

### Variables de entorno / configuración

| Variable / contexto | Uso |
|---------------------|-----|
| `PROJECT_ID` | Proyecto GCP (scripts locales). En deploy no usar `PROJECT_ID` en .env (reservado). |
| `VERTEX_AI_LOCATION` | Región Vertex (ej. `europe-west1`). |
| `GEMINI_API_KEY` | (Opcional) API key Google AI Studio si no se usa Vertex. |
| `GEMINI_EXTRACTION_ENABLED` | Activar uso de IA en extracción de página (por defecto `true` con límites). |
| `GEMINI_CRITERIA_EXTRACTION_ENABLED` | Activar extracción de criterios desde instrucción (por defecto `true`). |
| `GEMINI_PRODUCT_TYPE_FILTER_ENABLED` | Desactivar filtro por tipo de producto: `false` (por defecto `true` si IA disponible). |
| `GEMINI_RELEVANCE_FILTER_ENABLED` | Desactivar filtro de relevancia sobre matches: `false` (por defecto `true` si IA disponible). Reduce falsos positivos (precio/talla erróneos, componentes vs producto completo). |
| Límites por run | Máximo de páginas paginadas, máximo de llamadas IA por job, máximo de tokens por llamada (definidos en código o config). |

### Costes

- **Extracción de criterios:** 1 llamada por tracking al crear/actualizar; impacto bajo.
- **Filtro por tipo de producto:** 1 llamada por tracking por ejecución cuando hay `productTypeHint`; entrada acotada (lista de productos).
- **Extracción de página:** solo cuando sea necesario y con tope por ejecución (p. ej. 1 llamada por tracking por run, o solo cuando schema + heurísticas fallen).
- Uso de **Gemini 2.0 Flash** y límites estrictos mantiene costes predecibles.

---

## Paginación

- Detección de “siguiente página” en la página de resultados (enlaces “Siguiente”, parámetros `page`, `offset`, etc.), mediante heurísticas o patrones conocidos.
- Por ejecución del job, no superar `paginationLimit` páginas (valor por tracking, con un máximo global por defecto).
- Cada página se analiza con el mismo pipeline (schema → heurísticas → IA si aplica); los productos se agregan a un único conjunto para deduplicar y evaluar criterios.

---

## Estados de desarrollo

- **Fase 0:** Diseño y arquitectura (este plan).
- **Fase 1:** Endpoint de tracking (URL + instrucción) y extracción de criterios con IA (instrucción → criterios estructurados).
- **Fase 2:** Pipeline de análisis de página (schema, heurísticas, IA acotada) y evaluación de criterios.
- **Fase 3:** Paginación (detección + límites) e integración en el job programado.
- **Fase 4:** Alertas por email, optimización de costes y observabilidad.

---

## Despliegue en Firebase Functions

- Node.js 18+
- Firebase CLI y proyecto Firebase creado.
- Deploy: `firebase deploy --only functions`.

---

## Conclusión

El sistema pone la **instrucción en lenguaje natural** y la **URL** en el centro: la IA interpreta la intención del usuario y genera criterios estructurados; luego el análisis de la página (y sus páginas siguientes si hay paginación) se hace con un uso de IA muy acotado, priorizando schema y heurísticas. Así se mantiene la flexibilidad y la experiencia de usuario sin descontrol de peticiones ni costes.
