/**
 * Servicios - Lógica de negocio
 * Exporta los servicios de la aplicación
 */

export {
  fetchHtml,
  FetchHtmlError,
  type FetchHtmlResult,
  type FetchHtmlErrorDetails,
} from "./httpClient";

export {
  extractProductsFromHtml,
  computeConfidenceScore,
  type ExtractedProduct,
} from "./schemaExtractor";

export { findMatches, type CriteriaMatch } from "./criteriaAnalyzer";

export {
  extractProductsHeuristic,
  extractWithFallback,
} from "./heuristicParser";

export {
  isAiExtractionAvailable,
  extractProductsWithAi,
  htmlToPlainText,
} from "./aiExtractor";

export {
  initializeFirebaseAdmin,
  createTracking,
  getTrackingById,
  listTrackings,
  getActivePendingCheck,
  updateLastChecked,
  updateTracking,
  deleteTracking,
  type TrackingDocument,
} from "./trackingRepository";

export { getNextPageUrl, getDefaultPaginationLimit } from "./paginationHelper";

export {
  saveMatch,
  getUnnotifiedMatches,
  markAsNotified,
  markManyAsNotified,
} from "./matchRepository";

export {
  getSmtpConfigFromEnv,
  getTransporter,
  buildAlertHtml,
  sendAlertEmail,
  resetTransporter,
  type SmtpConfig,
  type MatchItem,
  type SendAlertResult,
} from "./emailService";
