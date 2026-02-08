/**
 * Repositorio de matches en Firestore.
 * Guardado con deduplicación por trackingId + product.url, consulta de no notificados y marcado como notificado.
 *
 * Índices compuestos en Firestore (crear desde la consola o firestore.indexes.json):
 * - matches: trackingId (asc), product.url (asc) — para deduplicar en saveMatch
 * - matches: notified (asc), detectedAt (desc) — para getUnnotifiedMatches sin trackingId
 * - matches: trackingId (asc), notified (asc), detectedAt (desc) — para getUnnotifiedMatches con trackingId
 */

import * as admin from "firebase-admin";
import type { Match, Product } from "../types";
import { initializeFirebaseAdmin } from "./trackingRepository";

const COLLECTION = "matches";

function getDb(): admin.firestore.Firestore {
  initializeFirebaseAdmin();
  return admin.firestore();
}

function docToMatch(id: string, data: FirebaseFirestore.DocumentData): Match & { id: string } {
  return {
    id,
    trackingId: data.trackingId,
    product: data.product as Product,
    confidenceScore: data.confidenceScore,
    detectedAt: data.detectedAt,
    notified: data.notified === true,
  };
}

/**
 * Guarda un nuevo match si no existe ya uno con el mismo trackingId y product.url.
 * Evita duplicados consultando por trackingId + product.url antes de insertar.
 *
 * @param match - Match a guardar (detectedAt como Firestore Timestamp, notified por defecto false)
 * @returns Id del documento creado o null si ya existía un match duplicado
 */
export async function saveMatch(
  match: Omit<Match, "notified"> & { notified?: boolean }
): Promise<string | null> {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc();
  const productUrl = match.product?.url ?? "";

  const created = await db.runTransaction(async (transaction) => {
    const existing = await db
      .collection(COLLECTION)
      .where("trackingId", "==", match.trackingId)
      .where("product.url", "==", productUrl)
      .limit(1)
      .get();

    if (!existing.empty) {
      return null;
    }

    const payload = {
      trackingId: match.trackingId,
      product: match.product,
      confidenceScore: match.confidenceScore,
      detectedAt: match.detectedAt,
      notified: match.notified === true,
    };
    transaction.set(ref, payload);
    return ref.id;
  });

  return created;
}

/**
 * Obtiene matches que aún no han sido notificados.
 *
 * @param options.trackingId - Si se indica, solo matches de ese tracking
 * @param options.limit - Límite de resultados (default 100)
 */
export async function getUnnotifiedMatches(options?: {
  trackingId?: string;
  limit?: number;
}): Promise<Array<Match & { id: string }>> {
  const db = getDb();
  const limit = options?.limit ?? 100;

  let query: admin.firestore.Query = db
    .collection(COLLECTION)
    .where("notified", "==", false)
    .orderBy("detectedAt", "desc")
    .limit(limit);

  if (options?.trackingId) {
    query = db
      .collection(COLLECTION)
      .where("trackingId", "==", options.trackingId)
      .where("notified", "==", false)
      .orderBy("detectedAt", "desc")
      .limit(limit);
  }

  const snapshot = await query.get();
  return snapshot.docs.map((doc) => docToMatch(doc.id, doc.data()));
}

/**
 * Marca un match como notificado.
 */
export async function markAsNotified(matchId: string): Promise<void> {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(matchId);
  await ref.update({ notified: true });
}

/**
 * Marca varios matches como notificados en lote (una escritura por documento).
 */
export async function markManyAsNotified(matchIds: string[]): Promise<void> {
  const db = getDb();
  const batch = db.batch();
  for (const id of matchIds) {
    batch.update(db.collection(COLLECTION).doc(id), { notified: true });
  }
  await batch.commit();
}
