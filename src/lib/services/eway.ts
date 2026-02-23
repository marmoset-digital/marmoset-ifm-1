// ===========================================
// eWAY PAYMENT SERVICE
// ===========================================
// Handles payment processing via eWAY Rapid API.
// Docs: https://eway.io/api-v3/

import { withSyncLogging } from "@/lib/sync-logger";
import type { ParsedOrder } from "@/types";

const EWAY_ENDPOINT = process.env.EWAY_ENDPOINT || "https://api.ewaypayments.com";
const EWAY_API_KEY = process.env.EWAY_API_KEY!;
const EWAY_API_PASSWORD = process.env.EWAY_API_PASSWORD!;

/**
 * Base64-encoded auth header for eWAY Rapid API.
 */
function getAuthHeader(): string {
  const credentials = Buffer.from(`${EWAY_API_KEY}:${EWAY_API_PASSWORD}`).toString("base64");
  return `Basic ${credentials}`;
}

/**
 * Make an authenticated request to eWAY.
 */
async function ewayRequest(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${EWAY_ENDPOINT}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: getAuthHeader(),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`eWAY API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Process a credit card payment via eWAY.
 *
 * NOTE: In production, the actual credit card tokenisation typically
 * happens client-side via eWAY's Secure Fields or Transparent Redirect.
 * The Gravity Forms eWAY add-on handles this and passes a token/transaction ID.
 *
 * This function handles the server-side verification and capture.
 */
export async function processPayment(
  orderId: string,
  order: ParsedOrder,
  ewayTransactionId?: string
): Promise<{
  success: boolean;
  transactionId: string | null;
  errorMessage: string | null;
}> {
  // If we have a transaction ID from GF's eWAY integration,
  // we just need to verify/query it rather than create a new charge
  if (ewayTransactionId) {
    return verifyTransaction(orderId, ewayTransactionId);
  }

  // Otherwise, create a new transaction (for cases where payment
  // needs to be processed server-side)
  const payload = {
    Payment: {
      TotalAmount: Math.round(order.pricing.total * 100), // eWAY uses cents
      InvoiceNumber: order.uniqueId,
      InvoiceDescription: `Stormwater Services - ${order.uniqueId}`,
      InvoiceReference: order.uniqueId,
      CurrencyCode: "AUD",
    },
    Customer: {
      FirstName: order.customer.firstName,
      LastName: order.customer.lastName,
      Email: order.customer.email,
      Phone: order.customer.phone,
      Street1: order.billing.street,
      City: order.billing.city,
      State: order.billing.state,
      PostalCode: order.billing.postcode,
      Country: "au",
    },
    TransactionType: "Purchase",
    Method: "ProcessPayment",
  };

  return withSyncLogging(
    {
      orderId,
      service: "eway",
      action: "process_payment",
      requestPayload: payload as Record<string, unknown>,
    },
    async () => {
      const result = await ewayRequest("/Transaction", payload);

      const success = result.TransactionStatus === true;
      return {
        success,
        transactionId: result.TransactionID?.toString() ?? null,
        errorMessage: success ? null : (result.ResponseMessage ?? "Payment failed"),
      };
    }
  );
}

/**
 * Verify an existing eWAY transaction (e.g. from Gravity Forms eWAY add-on).
 */
async function verifyTransaction(
  orderId: string,
  transactionId: string
): Promise<{
  success: boolean;
  transactionId: string | null;
  errorMessage: string | null;
}> {
  return withSyncLogging(
    {
      orderId,
      service: "eway",
      action: "verify_transaction",
      requestPayload: { transactionId },
    },
    async () => {
      const response = await fetch(
        `${EWAY_ENDPOINT}/Transaction/${transactionId}`,
        {
          method: "GET",
          headers: {
            Authorization: getAuthHeader(),
          },
        }
      );

      if (!response.ok) {
        throw new Error(`eWAY verify failed (${response.status})`);
      }

      const result = await response.json();
      const success = result.Transactions?.[0]?.TransactionStatus === true;

      return {
        success,
        transactionId: success ? transactionId : null,
        errorMessage: success ? null : "Transaction verification failed",
      };
    }
  );
}
