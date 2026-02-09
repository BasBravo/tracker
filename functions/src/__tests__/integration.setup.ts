/**
 * Setup para tests de integración con Firebase Emulator.
 * Ejecutar con: RUN_INTEGRATION_TESTS=1 npm test -- integration.test
 * Con el emulador levantado: firebase emulators:start --only firestore
 */
if (process.env.RUN_INTEGRATION_TESTS === "1") {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
  process.env.PROJECT_ID = process.env.PROJECT_ID || "demo-tracker";
}
