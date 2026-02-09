/**
 * Servicios - Lógica de negocio
 * Exporta los servicios de la aplicación
 */

export {
  fetchHtml,
  fetchHtmlHeadless,
  isHeadlessFetchAvailable,
  FetchHtmlError,
  FETCH_ERROR_ANTIBOT,
  type FetchHtmlResult,
  type FetchHtmlErrorDetails,
} from "./httpClient";

export {
  extractProductsFromHtml,
  extractProductsFromEmbeddedJson,
  computeConfidenceScore,
  type ExtractedProduct,
} from "./schemaExtractor";

export { findMatches, getMatchScore, MIN_MATCH_SCORE, isRequestedSizeAvailable, type CriteriaMatch } from "./criteriaAnalyzer";

export {
  extractAvailabilityFromProductPage,
  type PageAvailability,
} from "./availabilityExtractor";

export {
  verifyMatchOnProductPage,
  verifyMatchesOnProductPages,
  MAX_PRODUCT_PAGES_TO_VERIFY,
  type VerifyResult,
} from "./productPageVerifier";

export {
  extractProductsHeuristic,
  extractWithFallback,
} from "./heuristicParser";

export {
  isAiExtractionAvailable,
  extractProductsWithAi,
  htmlToPlainText,
  isProductTypeFilterAvailable,
  filterProductsByType,
  isRelevanceFilterAvailable,
  filterMatchesByRelevance,
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
