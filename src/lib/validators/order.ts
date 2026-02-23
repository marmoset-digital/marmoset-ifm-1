// ===========================================
// ORDER VALIDATOR
// ===========================================
// Validates parsed orders before processing.
// Includes the $20,000 credit card threshold rule.

import type { ParsedOrder } from "@/types";

const MINIMUM_CC_THRESHOLD = parseInt(
  process.env.MINIMUM_CREDIT_CARD_THRESHOLD || "20000"
);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a parsed order before processing.
 */
export function validateOrder(order: ParsedOrder): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // --- Required fields ---
  if (!order.uniqueId) errors.push("Missing unique order ID");
  if (!order.customer.firstName) errors.push("Missing customer first name");
  if (!order.customer.lastName) errors.push("Missing customer last name");
  if (!order.customer.email) errors.push("Missing customer email");
  if (!order.customer.phone) errors.push("Missing customer phone");
  if (!order.jobLocation.street) errors.push("Missing job location street address");
  if (!order.jobLocation.city) errors.push("Missing job location city");
  if (!order.jobLocation.postcode) errors.push("Missing job location postcode");
  if (!order.billing.name) errors.push("Missing billing name");
  if (!order.jobDetails.serviceType) errors.push("Missing service type");
  if (!order.jobDetails.hydraulicEngineerName) errors.push("Missing hydraulic engineer name");

  // --- Payment validation ---
  if (!order.payment.method) {
    errors.push("Missing payment method");
  }

  // SERVER-SIDE ENFORCEMENT: $20k credit card threshold
  // The form handles this client-side, but we enforce it here as a safety net.
  if (
    order.payment.method === "Bank Transfer" &&
    order.pricing.total < MINIMUM_CC_THRESHOLD
  ) {
    errors.push(
      `Bank transfer not permitted for orders under $${MINIMUM_CC_THRESHOLD.toLocaleString()}. ` +
      `Order total is $${order.pricing.total.toLocaleString()}. ` +
      `Credit card payment is required.`
    );
  }

  // --- Terms & conditions ---
  if (!order.jobDetails.termsAccepted) {
    errors.push("Terms of service not accepted");
  }
  if (!order.jobDetails.rockOrSandAccepted) {
    errors.push("Rock or sand strata terms not accepted");
  }
  if (!order.jobDetails.exclusionsAccepted) {
    errors.push("Exclusions not accepted");
  }

  // --- Pricing sanity checks ---
  if (order.pricing.total <= 0) {
    errors.push("Order total must be greater than $0");
  }

  if (order.pricing.gst <= 0 && order.pricing.subtotal > 0) {
    warnings.push("GST is $0 — this may indicate a pricing issue");
  }

  // --- Service-specific validation ---
  const serviceType = order.jobDetails.serviceType;

  if (
    (serviceType.includes("OSD") || serviceType.includes("full service")) &&
    order.osdTanks.length === 0
  ) {
    warnings.push("OSD service selected but no tank specifications provided");
  }

  if (
    (serviceType.includes("Easement") || serviceType.includes("full service")) &&
    order.piping.length === 0
  ) {
    warnings.push("Stormwater easement selected but no piping specifications provided");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
