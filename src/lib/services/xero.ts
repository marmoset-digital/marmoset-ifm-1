// ===========================================
// XERO SERVICE
// ===========================================
// Creates contacts and invoices in Xero.
// Uses Xero OAuth2 API.
// Docs: https://developer.xero.com/documentation/api/accounting

import { withSyncLogging } from "@/lib/sync-logger";
import {
  buildXeroContactPayload,
  buildXeroInvoicePayload,
} from "@/lib/mappers/xero";
import type { ParsedOrder } from "@/types";

const XERO_BASE_URL = "https://api.xero.com/api.xro/2.0";

// NOTE: In production, you'll need OAuth2 token refresh logic.
// The xero-node SDK handles this automatically, but here we
// show the raw API approach for clarity. Consider using the
// xero-node SDK's TokenSet refresh in production.
let accessToken = process.env.XERO_ACCESS_TOKEN!;
const tenantId = process.env.XERO_TENANT_ID!;

/**
 * Make an authenticated request to Xero.
 */
async function xeroRequest(
  path: string,
  method: "GET" | "POST" | "PUT" = "GET",
  body?: Record<string, unknown>
) {
  const response = await fetch(`${XERO_BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Xero-Tenant-Id": tenantId,
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401) {
    // Token expired — in production, trigger a refresh here
    throw new Error("Xero access token expired — refresh required");
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Xero API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Search for an existing contact by email to avoid duplicates.
 */
async function findContactByEmail(email: string): Promise<string | null> {
  try {
    const result = await xeroRequest(
      `/Contacts?where=EmailAddress=="${encodeURIComponent(email)}"`
    );

    if (result.Contacts && result.Contacts.length > 0) {
      return result.Contacts[0].ContactID;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Create or find a contact in Xero.
 */
export async function createOrFindContact(
  orderId: string,
  order: ParsedOrder
): Promise<string> {
  const payload = buildXeroContactPayload(order);

  return withSyncLogging(
    {
      orderId,
      service: "xero",
      action: "create_or_find_contact",
      requestPayload: payload as Record<string, unknown>,
    },
    async () => {
      // Check for existing contact first
      const existingId = await findContactByEmail(order.customer.email);
      if (existingId) {
        console.log(`[Xero] Found existing contact: ${existingId}`);
        return existingId;
      }

      // Create new contact
      const result = await xeroRequest("/Contacts", "POST", {
        Contacts: [payload],
      });

      const contactId = result.Contacts?.[0]?.ContactID;
      if (!contactId) {
        throw new Error("Xero did not return a Contact ID");
      }

      console.log(`[Xero] Created new contact: ${contactId}`);
      return contactId;
    }
  );
}

/**
 * Create a draft invoice in Xero.
 */
export async function createInvoice(
  orderId: string,
  order: ParsedOrder,
  xeroContactId: string
): Promise<string> {
  const payload = buildXeroInvoicePayload(order, xeroContactId);

  return withSyncLogging(
    {
      orderId,
      service: "xero",
      action: "create_invoice",
      requestPayload: payload as Record<string, unknown>,
    },
    async () => {
      const result = await xeroRequest("/Invoices", "POST", {
        Invoices: [payload],
      });

      const invoiceId = result.Invoices?.[0]?.InvoiceID;
      if (!invoiceId) {
        throw new Error("Xero did not return an Invoice ID");
      }

      console.log(`[Xero] Created invoice: ${invoiceId} (Status: ${payload.Status})`);
      return invoiceId;
    }
  );
}

/**
 * Record a payment against a Xero invoice (for credit card payments).
 * This marks the invoice as PAID in Xero once eWAY confirms the charge.
 */
export async function recordPayment(
  orderId: string,
  xeroInvoiceId: string,
  amount: number,
  reference: string
): Promise<string> {
  const payload = {
    Invoice: { InvoiceID: xeroInvoiceId },
    Account: { Code: "090" },  // Adjust to your bank/clearing account code
    Date: new Date().toISOString().split("T")[0],
    Amount: amount,
    Reference: `eWAY payment — ${reference}`,
  };

  return withSyncLogging(
    {
      orderId,
      service: "xero",
      action: "record_payment",
      requestPayload: payload as Record<string, unknown>,
    },
    async () => {
      const result = await xeroRequest("/Payments", "PUT", payload);

      const paymentId = result.Payments?.[0]?.PaymentID;
      if (!paymentId) {
        throw new Error("Xero did not return a Payment ID");
      }

      console.log(`[Xero] Recorded payment: ${paymentId}`);
      return paymentId;
    }
  );
}

/**
 * Full Xero sync: create contact + invoice (+ payment if credit card).
 */
export async function syncToXero(
  orderId: string,
  order: ParsedOrder,
  paymentConfirmed: boolean
): Promise<{ contactId: string; invoiceId: string }> {
  const contactId = await createOrFindContact(orderId, order);
  const invoiceId = await createInvoice(orderId, order, contactId);

  // If credit card payment was already confirmed via eWAY, record it in Xero
  if (paymentConfirmed && order.payment.method === "Credit Card") {
    await recordPayment(orderId, invoiceId, order.pricing.total, order.uniqueId);
  }

  return { contactId, invoiceId };
}
