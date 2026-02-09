/**
 * Validadores y sanitización de inputs usando Zod.
 * URLs, criterios de tracking, emails y utilidades de saneo.
 */

import { z } from "zod";
import type { Criteria } from "../types";

/** Longitud máxima para strings de entrada (evitar payloads enormes). */
const MAX_STRING_LENGTH = 2048;

/** Regex básico para email (RFC 5322 simplificado). */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Esquemas Zod ───────────────────────────────────────────────────────────

/** URL absoluta http o https. */
export const urlSchema = z
  .string()
  .trim()
  .min(1, "La URL es obligatoria")
  .max(MAX_STRING_LENGTH, "URL demasiado larga")
  .refine((val: string) => {
    try {
      const u = new URL(val);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, "Debe ser una URL válida (http o https)");

/** Email válido. */
export const emailSchema = z
  .string()
  .trim()
  .min(1, "El email es obligatorio")
  .max(320, "Email demasiado largo")
  .refine((val: string) => EMAIL_REGEX.test(val), "Formato de email no válido");

/** Criterios de tracking (priceMax, size, color opcionales). */
export const criteriaSchema = z.object({
  priceMax: z
    .number()
    .min(0, "priceMax debe ser >= 0")
    .optional(),
  size: z
    .string()
    .trim()
    .max(64)
    .nullish()
    .transform((s: string | null | undefined) => (s === "" || s == null ? undefined : s)),
  color: z
    .string()
    .trim()
    .max(64)
    .nullish()
    .transform((s: string | null | undefined) => (s === "" || s == null ? undefined : s)),
});

/** Frecuencias permitidas. */
export const trackingFrequencySchema = z.enum(["hourly", "daily", "weekly"]);

/** Instrucción en lenguaje natural (obligatoria en creación de tracking). */
export const instructionSchema = z
  .string()
  .trim()
  .min(10, "La instrucción debe tener al menos 10 caracteres")
  .max(2000, "La instrucción no puede superar 2000 caracteres");

/** Límite de páginas a analizar en paginación (1–20). */
export const paginationLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(20)
  .optional()
  .default(5);

// ─── Validación ──────────────────────────────────────────────────────────────

/**
 * Valida una URL (http/https).
 * @param value - Valor a validar
 * @returns Resultado con datos parseados o error de Zod
 */
export function validateUrl(value: unknown): z.SafeParseReturnType<string, string> {
  return urlSchema.safeParse(value);
}

/**
 * Valida un email.
 * @param value - Valor a validar
 * @returns Resultado con email parseado o error de Zod
 */
export function validateEmail(value: unknown): z.SafeParseReturnType<string, string> {
  return emailSchema.safeParse(value);
}

/**
 * Valida criterios de tracking (objeto con priceMax, size, color opcionales).
 * @param value - Objeto a validar
 * @returns Resultado con Criteria o error de Zod
 */
export function validateCriteria(value: unknown): z.SafeParseReturnType<unknown, Criteria> {
  return criteriaSchema.safeParse(value) as z.SafeParseReturnType<unknown, Criteria>;
}

/**
 * Valida que un string sea una frecuencia permitida.
 */
export function validateTrackingFrequency(
  value: unknown
): z.SafeParseReturnType<string, "hourly" | "daily" | "weekly"> {
  return trackingFrequencySchema.safeParse(value);
}

/**
 * Valida la instrucción en lenguaje natural.
 */
export function validateInstruction(value: unknown): z.SafeParseReturnType<unknown, string> {
  return instructionSchema.safeParse(value);
}

/**
 * Valida paginationLimit (opcional, 1–20). Si no se envía o es inválido, devuelve 5.
 */
export function validatePaginationLimit(
  value: unknown
): z.SafeParseReturnType<unknown, number> {
  const raw =
    value === undefined || value === null
      ? undefined
      : typeof value === "string"
        ? parseInt(value, 10)
        : value;
  const toParse =
    raw === undefined || typeof raw !== "number" || Number.isNaN(raw) ? undefined : raw;
  return paginationLimitSchema.safeParse(toParse);
}

// ─── Sanitización ─────────────────────────────────────────────────────────────

/**
 * Sanitiza un string: trim y límite de longitud.
 * @param value - String de entrada
 * @param maxLength - Longitud máxima (default MAX_STRING_LENGTH)
 * @returns String sanitizado o undefined si value no es string
 */
export function sanitizeString(
  value: unknown,
  maxLength: number = MAX_STRING_LENGTH
): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim().slice(0, maxLength) || undefined;
}

/**
 * Sanitiza un objeto de criterios desde entrada cruda (ej. body de request).
 * Aplica trim a strings y asegura priceMax numérico >= 0.
 */
export function sanitizeCriteria(value: unknown): Criteria {
  const parsed = criteriaSchema.safeParse(value);
  if (parsed.success) return parsed.data as Criteria;
  return {};
}

/**
 * Sanitiza una URL: trim, límite de longitud y comprobación de protocolo.
 * No valida dominio ni existencia; solo formato.
 */
export function sanitizeUrl(value: unknown): string | undefined {
  const str = sanitizeString(value, 2048);
  if (!str) return undefined;
  try {
    const u = new URL(str);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    return str;
  } catch {
    return undefined;
  }
}

/**
 * Sanitiza un email: trim y límite de longitud (320 caracteres).
 */
export function sanitizeEmail(value: unknown): string | undefined {
  const str = sanitizeString(value, 320);
  if (!str) return undefined;
  return EMAIL_REGEX.test(str) ? str : undefined;
}

/**
 * Sanitiza un número dentro de un rango (p. ej. priceMax).
 */
export function sanitizeNumber(
  value: unknown,
  options: { min?: number; max?: number; default?: number } = {}
): number | undefined {
  const num = typeof value === "string" ? Number(value) : value;
  if (typeof num !== "number" || Number.isNaN(num)) return options.default;
  let result = num;
  if (options.min != null && result < options.min) result = options.min;
  if (options.max != null && result > options.max) result = options.max;
  return result;
}
