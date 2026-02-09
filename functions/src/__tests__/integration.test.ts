/**
 * Test de integración: flow completo con Firebase Emulator.
 * Creación de tracking → detección (mock HTML) → matches en Firestore → notificación (mock email) → marcado notificado → cleanup.
 *
 * Requisitos:
 * - Emulator: firebase emulators:start --only firestore
 * - Ejecutar: RUN_INTEGRATION_TESTS=1 npm test -- integration.test
 */

const TEST_URL = "https://example.com/test-product-page";
const TEST_EMAIL = "test-integration@example.com";

jest.mock("../services/httpClient", () => ({
  fetchHtml: jest.fn(),
  FetchHtmlError: class FetchHtmlError extends Error {
    constructor(details: { message: string }) {
      super(details.message);
      this.name = "FetchHtmlError";
    }
  },
}));

jest.mock("../services/emailService", () => ({
  sendAlertEmail: jest.fn().mockResolvedValue({ success: true, messageId: "test-msg-id" }),
}));

import * as admin from "firebase-admin";
import { createTracking, initializeFirebaseAdmin } from "../services/trackingRepository";
import { getUnnotifiedMatches } from "../services/matchRepository";
import { runScheduledTrackingCheck } from "../jobs/scheduledTrackingCheck";
import { runScheduledNotifications } from "../jobs/scheduledNotifications";
import { fetchHtml } from "../services/httpClient";
import { sendAlertEmail } from "../services/emailService";
import { HTML_PRODUCT_SCHEMA } from "./fixtures/htmlMocks";

const COLLECTION_TRACKINGS = "trackings";
const COLLECTION_MATCHES = "matches";

async function cleanupTrackingAndMatches(trackingId: string): Promise<void> {
  const db = admin.firestore();
  const matchesSnap = await db
    .collection(COLLECTION_MATCHES)
    .where("trackingId", "==", trackingId)
    .get();
  const batch = db.batch();
  matchesSnap.docs.forEach((doc) => batch.delete(doc.ref));
  const trackingRef = db.collection(COLLECTION_TRACKINGS).doc(trackingId);
  batch.delete(trackingRef);
  await batch.commit();
}

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";

(runIntegration ? describe : describe.skip)("integration: flow completo", () => {
  const createdTrackingIds: string[] = [];

  beforeAll(() => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      console.warn(
        "FIRESTORE_EMULATOR_HOST no definido. Ejecutar con: RUN_INTEGRATION_TESTS=1 npm test -- integration.test"
      );
    }
    initializeFirebaseAdmin();
  });

  afterEach(async () => {
    for (const id of createdTrackingIds) {
      try {
        await cleanupTrackingAndMatches(id);
      } catch (e) {
        console.warn("Cleanup warning:", e);
      }
    }
    createdTrackingIds.length = 0;
    jest.clearAllMocks();
  });

  it("crea tracking → detección guarda match → notificación marca como notificado", async () => {
    (fetchHtml as jest.Mock).mockResolvedValue({
      html: HTML_PRODUCT_SCHEMA,
      finalUrl: TEST_URL,
      status: 200,
    });

    const tracking = await createTracking({
      url: TEST_URL,
      instruction: "Quiero que me avises cuando haya productos talla L por menos de 100 euros en negro.",
      email: TEST_EMAIL,
      criteria: { priceMax: 100, size: "L", color: "negro" },
      frequency: "daily",
      active: true,
    });
    createdTrackingIds.push(tracking.id);

    expect(tracking.id).toBeDefined();
    expect(tracking.url).toBe(TEST_URL);
    expect(tracking.email).toBe(TEST_EMAIL);
    expect(tracking.instruction).toBeDefined();

    await runScheduledTrackingCheck();

    expect(fetchHtml).toHaveBeenCalledWith(TEST_URL, expect.any(Object));

    const unnotifiedBefore = await getUnnotifiedMatches({ trackingId: tracking.id });
    expect(unnotifiedBefore.length).toBeGreaterThanOrEqual(1);
    const matchProduct = unnotifiedBefore[0].product;
    expect(matchProduct.name).toBe("Camiseta Básica");
    expect(matchProduct.price).toBe(29.99);
    expect(matchProduct.size).toBe("L");
    expect(matchProduct.color).toBe("negro");

    await runScheduledNotifications();

    expect(sendAlertEmail).toHaveBeenCalledWith(
      TEST_EMAIL,
      expect.arrayContaining([
        expect.objectContaining({
          product: expect.objectContaining({ name: "Camiseta Básica" }),
        }),
      ]),
      undefined
    );

    const unnotifiedAfter = await getUnnotifiedMatches({ trackingId: tracking.id });
    expect(unnotifiedAfter).toHaveLength(0);
  });

  it("cleanup elimina tracking y sus matches", async () => {
    (fetchHtml as jest.Mock).mockResolvedValue({
      html: HTML_PRODUCT_SCHEMA,
      finalUrl: TEST_URL,
      status: 200,
    });

    const tracking = await createTracking({
      url: TEST_URL,
      instruction: "Avísame de ofertas por menos de 100 euros.",
      email: TEST_EMAIL,
      criteria: { priceMax: 100 },
      frequency: "daily",
      active: true,
    });
    createdTrackingIds.push(tracking.id);

    await runScheduledTrackingCheck();
    const matchesAfterCheck = await getUnnotifiedMatches({ trackingId: tracking.id });
    expect(matchesAfterCheck.length).toBeGreaterThanOrEqual(1);

    await cleanupTrackingAndMatches(tracking.id);
    createdTrackingIds.length = 0;

    const db = admin.firestore();
    const trackingSnap = await db.collection(COLLECTION_TRACKINGS).doc(tracking.id).get();
    expect(trackingSnap.exists).toBe(false);

    const matchesSnap = await db
      .collection(COLLECTION_MATCHES)
      .where("trackingId", "==", tracking.id)
      .get();
    expect(matchesSnap.empty).toBe(true);
  });
});
