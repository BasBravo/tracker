/**
 * Repositorio de trackings en Firestore.
 * Inicialización de Firebase Admin, CRUD completo y operaciones con transacciones.
 */

import * as admin from "firebase-admin";
import type { Criteria, TrackingConfig, TrackingFrequency } from "../types";

const COLLECTION = "trackings";

/** Intervalos mínimos entre chequeos por frecuencia (ms). */
const FREQUENCY_MS: Record<TrackingFrequency, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

/** Tipo para documento de tracking en Firestore (lastChecked como Timestamp). */
export interface TrackingDocument {
  url: string;
  instruction: string;
  criteria: Criteria;
  email: string;
  frequency: TrackingFrequency;
  active: boolean;
  lastChecked: admin.firestore.Timestamp | null;
  paginationLimit?: number;
}

let adminInitialized = false;

/**
 * Inicializa Firebase Admin (idempotente).
 * Si PROJECT_ID o PROJECT_ID están definidos, se usa ese proyecto
 * (evita usar el proyecto de la cuenta de servicio cuando se ejecutan scripts en local).
 */
export function initializeFirebaseAdmin(): void {
  if (adminInitialized) return;
  if (admin.apps.length === 0) {
    const projectId =
      process.env.PROJECT_ID ?? process.env.PROJECT_ID;
    admin.initializeApp(projectId ? { projectId } : undefined);
  }
  adminInitialized = true;
}

function getDb(): admin.firestore.Firestore {
  initializeFirebaseAdmin();
  return admin.firestore();
}

function docToConfig(
  id: string,
  data: FirebaseFirestore.DocumentData
): TrackingConfig & { id: string } {
  const lastChecked = data.lastChecked ?? null;
  const out: TrackingConfig & { id: string } = {
    id,
    url: data.url,
    instruction: typeof data.instruction === "string" ? data.instruction : "",
    criteria: data.criteria ?? {},
    email: data.email,
    frequency: data.frequency,
    active: data.active === true,
    lastChecked: lastChecked as TrackingConfig["lastChecked"],
  };
  if (typeof data.paginationLimit === "number" && data.paginationLimit >= 1) {
    out.paginationLimit = data.paginationLimit;
  }
  return out;
}

/**
 * Crea un tracking. Usa transacción para garantizar consistencia si se añaden reglas de unicidad.
 */
export async function createTracking(
  data: Omit<TrackingConfig, "lastChecked">
): Promise<TrackingConfig & { id: string }> {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc();

  return db.runTransaction(async (transaction) => {
    const payload: Omit<TrackingDocument, "lastChecked"> & { lastChecked: null } = {
      url: data.url,
      instruction: data.instruction,
      criteria: data.criteria,
      email: data.email,
      frequency: data.frequency,
      active: data.active,
      lastChecked: null,
      ...(typeof data.paginationLimit === "number" && { paginationLimit: data.paginationLimit }),
    };
    transaction.set(ref, payload);
    return docToConfig(ref.id, { ...payload });
  });
}

/**
 * Obtiene un tracking por ID.
 */
export async function getTrackingById(
  id: string
): Promise<(TrackingConfig & { id: string }) | null> {
  const db = getDb();
  const snap = await db.collection(COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  return docToConfig(snap.id, snap.data()!);
}

/**
 * Lista todos los trackings (opcionalmente solo activos).
 */
export async function listTrackings(options?: {
  activeOnly?: boolean;
}): Promise<Array<TrackingConfig & { id: string }>> {
  const db = getDb();
  let query: admin.firestore.Query = db.collection(COLLECTION);

  if (options?.activeOnly) {
    query = query.where("active", "==", true);
  }

  const snapshot = await query.get();
  return snapshot.docs.map((doc) => docToConfig(doc.id, doc.data()));
}

/**
 * Obtiene trackings activos que están pendientes de chequeo según su frecuencia.
 * Un tracking está pendiente si lastChecked es null o han pasado al menos X ms según frequency.
 * Con options.force === true ignora la frecuencia y devuelve todos los activos (útil para pruebas).
 */
export async function getActivePendingCheck(
  limit = 50,
  options?: { force?: boolean }
): Promise<Array<TrackingConfig & { id: string }>> {
  const db = getDb();
  const now = Date.now();
  const snapshot = await db
    .collection(COLLECTION)
    .where("active", "==", true)
    .limit(limit * 3)
    .get();

  const pending: Array<TrackingConfig & { id: string }> = [];
  const interval = FREQUENCY_MS;
  const force = options?.force === true;

  for (const doc of snapshot.docs) {
    if (pending.length >= limit) break;
    const data = doc.data();
    if (force) {
      pending.push(docToConfig(doc.id, data));
      continue;
    }
    const frequency = data.frequency as TrackingFrequency;
    const minInterval = frequency ? interval[frequency] : FREQUENCY_MS.daily;
    const lastChecked = data.lastChecked as admin.firestore.Timestamp | null;
    const lastMs = lastChecked ? lastChecked.toMillis() : 0;
    if (now - lastMs >= minInterval) {
      pending.push(docToConfig(doc.id, data));
    }
  }

  return pending;
}

/**
 * Actualiza lastChecked de un tracking. Usa transacción.
 */
export async function updateLastChecked(
  id: string,
  timestamp?: admin.firestore.Timestamp
): Promise<void> {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(id);
  const value = timestamp ?? admin.firestore.Timestamp.now();

  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) {
      throw new Error(`Tracking no encontrado: ${id}`);
    }
    transaction.update(ref, { lastChecked: value });
  });
}

/**
 * Actualiza un tracking por ID. Campos parciales; usa transacción para la escritura.
 */
export async function updateTracking(
  id: string,
  data: Partial<Omit<TrackingConfig, "lastChecked">>
): Promise<void> {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(id);

  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) {
      throw new Error(`Tracking no encontrado: ${id}`);
    }
    const update: Record<string, unknown> = {};
    if (data.url !== undefined) update.url = data.url;
    if (data.instruction !== undefined) update.instruction = data.instruction;
    if (data.criteria !== undefined) update.criteria = data.criteria;
    if (data.email !== undefined) update.email = data.email;
    if (data.frequency !== undefined) update.frequency = data.frequency;
    if (data.active !== undefined) update.active = data.active;
    if (data.paginationLimit !== undefined) update.paginationLimit = data.paginationLimit;
    transaction.update(ref, update);
  });
}

/**
 * Elimina un tracking por ID. Usa transacción para comprobar existencia antes de borrar.
 */
export async function deleteTracking(id: string): Promise<void> {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(id);

  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) {
      throw new Error(`Tracking no encontrado: ${id}`);
    }
    transaction.delete(ref);
  });
}
