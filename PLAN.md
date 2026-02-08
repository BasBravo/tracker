# Plan técnico – Sistema de tracking de ofertas eCommerce (IA + Firebase)

## Objetivo

Construir un sistema que permita a un usuario introducir una URL de cualquier página eCommerce y definir criterios (precio, talla, color, etc.) para recibir alertas por email cuando aparezcan productos u ofertas que coincidan.

El sistema debe ser:

- Schema-first (priorizar datos estructurados)
- Tolerante a layouts distintos
- Escalable y con costes controlados
- Desplegado en Firebase Cloud Functions

---

## Alcance funcional (MVP)

**Incluido:**

- Tracking de URLs públicas (producto o listado)
- Extracción de productos y precios
- Filtros por precio, talla y color
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
  → Frontend (URL + criterios)
  → Firestore (configuración de tracking)
  → Cloud Scheduler
  → Cloud Functions (crawler + análisis)
  → Firestore (resultados)
  → Servicio de email
```

---

## Principios de diseño

1. **Schema-first**  
   Priorizar datos `schema.org` (JSON-LD).

2. **Fallback controlado**  
   Heurísticas simples antes de IA.

3. **Confianza explícita**  
   Cada match incluye un score.

4. **Idempotencia**  
   Mismas entradas producen mismos resultados.

---

## Modelo de datos (Firestore)

### Collection: trackings

```json
{
  "url": "https://example.com/ofertas",
  "criteria": {
    "priceMax": 1000,
    "size": "L",
    "color": "negro"
  },
  "email": "user@email.com",
  "frequency": "daily",
  "active": true,
  "lastChecked": "timestamp"
}
```

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

---

## Pipeline de análisis

1. Descarga del HTML  
2. Extracción de schema.org  
3. Normalización de datos  
4. Evaluación de criterios  
5. Fallback heurístico si falta información  
6. Generación de resultados y score  
7. Persistencia y notificación

---

## Estados de desarrollo

- **Fase 0:** Diseño y arquitectura  
- **Fase 1:** MVP schema-first  
- **Fase 2:** Robustez y heurísticas  
- **Fase 3:** Escalabilidad y control de costes  
- **Fase 4:** IA semántica opcional  

---

## Despliegue en Firebase Functions

### Requisitos

- Node.js 18+
- Firebase CLI
- Proyecto Firebase creado

### Inicialización

```bash
firebase init functions
```

### Deploy

```bash
firebase deploy --only functions
```

---

## Conclusión

El enfoque schema-first con fallback controlado permite construir un sistema versátil, escalable y realista para tracking de ofertas en eCommerce a nivel global.
