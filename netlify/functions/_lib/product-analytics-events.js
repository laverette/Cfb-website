/**
 * Canonical product analytics event names (2026 free beta).
 * Keep in sync with ALLOWED_EVENTS in netlify/functions/_lib/product-analytics.js
 */
const PRODUCT_EVENT_TYPES = Object.freeze({
  SESSION_STARTED: "session_started",
  USER_SIGNED_UP: "user_signed_up",
  USER_LOGGED_IN: "user_logged_in",
  PROP_LAB_OPENED: "prop_lab_opened",
  PLAYER_SEARCHED: "player_searched",
  PROP_EVALUATED: "prop_evaluated",
  PROP_ADDED_TO_CARD: "prop_added_to_card",
  PROP_REMOVED_FROM_CARD: "prop_removed_from_card",
  ENTRY_ANALYZED: "entry_analyzed",
  FIND_BEST_3_USED: "find_best_3_used",
  FIND_BEST_4_USED: "find_best_4_used",
  CARD_SAVED: "card_saved",
  CARD_SHARED: "card_shared",
  SHARED_CARD_OPENED: "shared_card_opened",
  SHARED_CARD_COPIED_TO_BUILDER: "shared_card_copied_to_builder",
  WEEKLY_PICKS_OPENED: "weekly_picks_opened",
  WEEKLY_PICK_SELECTED: "weekly_pick_selected",
  WEEKLY_PICKS_SUBMITTED: "weekly_picks_submitted",
  WEEKLY_RESULTS_VIEWED: "weekly_results_viewed",
  PREDICT_MATCHUP_CLICKED: "predict_matchup_clicked",
  MATCHUP_PREDICTION_COMPLETED: "matchup_prediction_completed",
  MATCHUP_PREDICTION_FAILED: "matchup_prediction_failed",
  FEATURE_ERROR: "feature_error",
  FEEDBACK_SUBMITTED: "feedback_submitted",
  VIEWER_SIGNED_UP: "viewer_signed_up",
  VIEWER_USED_PROP_LAB: "viewer_used_prop_lab",
  VIEWER_SHARED_CARD: "viewer_shared_card",
});

module.exports = { PRODUCT_EVENT_TYPES };
