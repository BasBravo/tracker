/**
 * Definiciones de tipos TypeScript del proyecto Tracker.
 * Alineados con el modelo de datos de Firestore y schema.org.
 */

/**
 * Tipo compatible con Firestore Timestamp (evita importar firebase-admin aquí).
 * En runtime usar `admin.firestore.Timestamp`.
 */
export interface AppTimestamp {
  toDate(): Date;
  toMillis(): number;
}

/** Frecuencias permitidas para la ejecución del tracking */
export type TrackingFrequency = "hourly" | "daily" | "weekly";

/**
 * Criterios de filtrado para el tracking.
 * Se aplican sobre los productos extraídos (precio máximo, talla, color).
 * Extraídos por IA a partir de la instrucción en lenguaje natural.
 */
export interface Criteria {
  /** Precio máximo aceptado (en la moneda del producto). */
  priceMax?: number;
  /** Precio mínimo razonable (inferido por IA según tipo de producto; filtra ruido de extracción). */
  priceMin?: number;
  /** Talla deseada (ej: "S", "M", "L", "42"). */
  size?: string;
  /** Color deseado (ej: "negro", "azul"). */
  color?: string;
  /** Pista de tipo de producto (ej: "bicicletas") para contexto. */
  productTypeHint?: string;
}

/**
 * Configuración de un tracking (colección `trackings` en Firestore).
 * La instrucción en lenguaje natural es la fuente; los criterios se extraen con IA.
 */
export interface TrackingConfig {
  /** URL pública del producto o listado eCommerce. */
  url: string;
  /** Instrucción en lenguaje natural del usuario (fuente de verdad). */
  instruction: string;
  /** Criterios estructurados extraídos por IA a partir de instruction. */
  criteria: Criteria;
  /** Email donde enviar las alertas. */
  email: string;
  /** Frecuencia de ejecución del chequeo. */
  frequency: TrackingFrequency;
  /** Si el tracking está activo. */
  active: boolean;
  /** Timestamp de la última comprobación. */
  lastChecked: AppTimestamp | null;
  /** Número máximo de páginas a analizar por ejecución (paginación). Por defecto 5. */
  paginationLimit?: number;
}

/**
 * Producto normalizado (salida del pipeline de análisis).
 * Usado en matches y en respuestas al usuario.
 */
export interface Product {
  /** Nombre del producto. */
  name: string;
  /** Precio numérico. */
  price: number;
  /** Código de moneda (ej: "EUR", "USD"). */
  currency: string;
  /** Talla si está disponible. */
  size?: string;
  /** Color si está disponible. */
  color?: string;
  /** URL de la página del producto. */
  url: string;
  /** URL de la imagen principal del producto. */
  image?: string;
}

/**
 * Resultado de un match: producto que cumple los criterios del tracking.
 * Colección `matches` en Firestore.
 */
export interface Match {
  /** Referencia al documento de tracking (ID o path). */
  trackingId: string;
  /** Producto que hizo match. */
  product: Product;
  /** Score de confianza del match (0–1). */
  confidenceScore: number;
  /** Timestamp de detección. */
  detectedAt: AppTimestamp;
  /** Si ya se envió la notificación por email. */
  notified: boolean;
}

/**
 * Oferta dentro de schema.org (Offer).
 * @see https://schema.org/Offer
 */
export interface SchemaOrgOffer {
  "@type": "Offer";
  price?: number;
  priceCurrency?: string;
  availability?: string;
  url?: string;
  priceValidUntil?: string;
}

/**
 * Propiedad adicional schema.org (ej: size, color).
 * @see https://schema.org/PropertyValue
 */
export interface SchemaOrgPropertyValue {
  "@type"?: "PropertyValue";
  name?: string;
  value?: string | number;
}

/**
 * Estructura de Product según schema.org (JSON-LD).
 * Prioridad en el pipeline de extracción; campos opcionales según implementaciones reales.
 * @see https://schema.org/Product
 */
export interface SchemaOrgProduct {
  "@context"?: "https://schema.org" | string;
  "@type": "Product";
  name?: string;
  description?: string;
  image?: string | string[];
  sku?: string;
  gtin?: string;
  brand?: {
    "@type"?: "Brand";
    name?: string;
  };
  offers?: SchemaOrgOffer | SchemaOrgOffer[];
  url?: string;
  /** Atributos como talla/color a menudo vienen aquí. */
  additionalProperty?: SchemaOrgPropertyValue[];
}

/**
 * Resultado de una validación: éxito con datos o error con mensajes.
 */
export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: string[];
}

/** Valores por defecto para Criteria (todos opcionales). */
const DEFAULT_CRITERIA: Criteria = {};

/**
 * Comprueba que un valor sea un Criteria válido.
 * @param value - Valor a validar
 * @returns Resultado de validación
 */
export function validateCriteria(value: unknown): ValidationResult<Criteria> {
  if (value === null || typeof value !== "object") {
    return { success: false, errors: ["Criteria debe ser un objeto"] };
  }
  const obj = value as Record<string, unknown>;
  const criteria: Criteria = { ...DEFAULT_CRITERIA };

  if (obj.priceMax !== undefined) {
    if (typeof obj.priceMax !== "number" || obj.priceMax < 0) {
      return { success: false, errors: ["criteria.priceMax debe ser un número >= 0"] };
    }
    criteria.priceMax = obj.priceMax;
  }
  if (obj.priceMin !== undefined) {
    if (typeof obj.priceMin !== "number" || obj.priceMin < 0) {
      return { success: false, errors: ["criteria.priceMin debe ser un número >= 0"] };
    }
    criteria.priceMin = obj.priceMin;
  }
  if (obj.size !== undefined) {
    if (typeof obj.size !== "string") {
      return { success: false, errors: ["criteria.size debe ser un string"] };
    }
    criteria.size = obj.size.trim() || undefined;
  }
  if (obj.color !== undefined) {
    if (typeof obj.color !== "string") {
      return { success: false, errors: ["criteria.color debe ser un string"] };
    }
    criteria.color = obj.color.trim() || undefined;
  }
  if (obj.productTypeHint !== undefined) {
    if (typeof obj.productTypeHint !== "string") {
      return { success: false, errors: ["criteria.productTypeHint debe ser un string"] };
    }
    criteria.productTypeHint = obj.productTypeHint.trim() || undefined;
  }

  return { success: true, data: criteria };
}

const VALID_FREQUENCIES: TrackingFrequency[] = ["hourly", "daily", "weekly"];

/**
 * Valida que un string sea una frecuencia permitida.
 */
export function isValidFrequency(value: unknown): value is TrackingFrequency {
  return typeof value === "string" && VALID_FREQUENCIES.includes(value as TrackingFrequency);
}

/**
 * Comprueba que un valor sea una URL absoluta válida.
 */
export function isValidUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

const MAX_INSTRUCTION_LENGTH = 2000;
const MIN_INSTRUCTION_LENGTH = 10;
const DEFAULT_PAGINATION_LIMIT = 5;
const MAX_PAGINATION_LIMIT = 20;

/**
 * Valida que la instrucción en lenguaje natural sea válida.
 */
export function validateInstruction(value: unknown): ValidationResult<string> {
  if (typeof value !== "string") {
    return { success: false, errors: ["instruction debe ser un string"] };
  }
  const trimmed = value.trim();
  if (trimmed.length < MIN_INSTRUCTION_LENGTH) {
    return { success: false, errors: [`instruction debe tener al menos ${MIN_INSTRUCTION_LENGTH} caracteres`] };
  }
  if (trimmed.length > MAX_INSTRUCTION_LENGTH) {
    return { success: false, errors: [`instruction no puede superar ${MAX_INSTRUCTION_LENGTH} caracteres`] };
  }
  return { success: true, data: trimmed };
}

/**
 * Valida paginationLimit (opcional, 1–MAX_PAGINATION_LIMIT).
 */
export function validatePaginationLimit(value: unknown): ValidationResult<number> {
  if (value === undefined || value === null) {
    return { success: true, data: DEFAULT_PAGINATION_LIMIT };
  }
  const num = typeof value === "string" ? parseInt(value, 10) : value;
  if (typeof num !== "number" || Number.isNaN(num)) {
    return { success: false, errors: ["paginationLimit debe ser un número"] };
  }
  if (num < 1 || num > MAX_PAGINATION_LIMIT) {
    return { success: false, errors: [`paginationLimit debe estar entre 1 y ${MAX_PAGINATION_LIMIT}`] };
  }
  return { success: true, data: num };
}

/**
 * Valida una configuración de tracking (sin lastChecked, que lo asigna el backend).
 * Usado internamente para el documento completo (url, instruction, criteria, email, etc.).
 */
export function validateTrackingConfig(
  value: unknown
): ValidationResult<Omit<TrackingConfig, "lastChecked">> {
  const errors: string[] = [];

  if (value === null || typeof value !== "object") {
    return { success: false, errors: ["TrackingConfig debe ser un objeto"] };
  }

  const obj = value as Record<string, unknown>;

  if (!obj.url || !isValidUrl(obj.url)) {
    errors.push("url es obligatoria y debe ser una URL http(s) válida");
  }
  const instructionResult = validateInstruction(obj.instruction);
  if (!instructionResult.success && instructionResult.errors) {
    errors.push(...instructionResult.errors);
  }
  const criteriaResult = validateCriteria(obj.criteria ?? {});
  if (!criteriaResult.success && criteriaResult.errors) {
    errors.push(...criteriaResult.errors);
  }
  if (typeof obj.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((obj.email as string).trim())) {
    errors.push("email es obligatorio y debe ser un email válido");
  }
  if (!isValidFrequency(obj.frequency)) {
    errors.push(`frequency debe ser uno de: ${VALID_FREQUENCIES.join(", ")}`);
  }
  if (typeof obj.active !== "boolean") {
    errors.push("active debe ser un booleano");
  }
  const paginationResult = validatePaginationLimit(obj.paginationLimit);
  if (!paginationResult.success && paginationResult.errors) {
    errors.push(...paginationResult.errors);
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  const data: Omit<TrackingConfig, "lastChecked"> = {
    url: (obj.url as string).trim(),
    instruction: instructionResult.data!,
    criteria: criteriaResult.data!,
    email: (obj.email as string).trim(),
    frequency: obj.frequency as TrackingFrequency,
    active: obj.active as boolean,
  };
  if (paginationResult.data != null) {
    data.paginationLimit = paginationResult.data;
  }
  return { success: true, data };
}

/**
 * Comprueba que un valor sea un Product normalizado válido.
 */
export function validateProduct(value: unknown): ValidationResult<Product> {
  const errors: string[] = [];
  if (value === null || typeof value !== "object") {
    return { success: false, errors: ["Product debe ser un objeto"] };
  }

  const obj = value as Record<string, unknown>;
  if (typeof obj.name !== "string" || !obj.name.trim()) errors.push("product.name es obligatorio");
  if (typeof obj.price !== "number" || obj.price < 0) errors.push("product.price debe ser un número >= 0");
  if (typeof obj.currency !== "string" || !obj.currency.trim()) errors.push("product.currency es obligatorio");
  if (!obj.url || !isValidUrl(obj.url)) errors.push("product.url es obligatoria y debe ser una URL válida");

  if (obj.size !== undefined && typeof obj.size !== "string") errors.push("product.size debe ser string si existe");
  if (obj.color !== undefined && typeof obj.color !== "string") errors.push("product.color debe ser string si existe");
  if (obj.image !== undefined && typeof obj.image !== "string") errors.push("product.image debe ser string si existe");

  if (errors.length > 0) return { success: false, errors };

  const product: Product = {
    name: (obj.name as string).trim(),
    price: obj.price as number,
    currency: (obj.currency as string).trim(),
    url: (obj.url as string).trim(),
  };
  if (typeof obj.size === "string" && obj.size.trim()) product.size = obj.size.trim();
  if (typeof obj.color === "string" && obj.color.trim()) product.color = obj.color.trim();
  if (typeof obj.image === "string" && obj.image.trim()) product.image = obj.image.trim();

  return { success: true, data: product };
}

/**
 * Comprueba que un valor sea un score de confianza válido (0–1).
 */
export function isValidConfidenceScore(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1 && !Number.isNaN(value);
}
