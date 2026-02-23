// ===========================================
// WEBHOOK: GRAVITY FORMS
// ===========================================
// POST /api/webhooks/gravity-forms
//
// Receives form submissions from Gravity Forms via webhook.
// This is the main entry point for the entire integration flow.
//
// Setup: In WordPress, install "GravityForms Webhooks" add-on and
// point it to: https://your-app.vercel.app/api/webhooks/gravity-forms

import { NextRequest, NextResponse } from "next/server";
import { processOrder } from "@/lib/orchestrator";
import type { GravityFormsPayload } from "@/types";

const GF_WEBHOOK_SECRET = process.env.GF_WEBHOOK_SECRET;

/**
 * Verify the webhook signature from Gravity Forms.
 * Adjust this based on your chosen webhook authentication method.
 */
function verifyWebhookSignature(request: NextRequest, body: string): boolean {
  if (!GF_WEBHOOK_SECRET) {
    console.warn("[Webhook] No GF_WEBHOOK_SECRET set — skipping verification");
    return true; // Allow in development, but MUST be set in production
  }

  // Option 1: Simple shared secret in header
  const signature = request.headers.get("x-gf-signature");
  if (signature === GF_WEBHOOK_SECRET) {
    return true;
  }

  // Option 2: Check a secret query parameter
  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");
  if (secret === GF_WEBHOOK_SECRET) {
    return true;
  }

  return false;
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();

    // Verify webhook authenticity
    if (!verifyWebhookSignature(request, rawBody)) {
      console.error("[Webhook] Invalid signature — rejecting");
      return NextResponse.json(
        { error: "Invalid webhook signature" },
        { status: 401 }
      );
    }

    // Parse the payload
    let payload: GravityFormsPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON payload" },
        { status: 400 }
      );
    }

    // Extract entry ID (Gravity Forms sends this as a top-level field)
    // The exact field name depends on your webhook config — common options:
    const entryId =
      (payload as Record<string, string>)["entry_id"] ??
      (payload as Record<string, string>)["id"] ??
      `gf-${Date.now()}`;

    // Extract eWAY transaction ID if present
    // (Gravity Forms eWAY add-on may include this in the payload)
    const ewayTransactionId =
      (payload as Record<string, string>)["eway_transaction_id"] ??
      (payload as Record<string, string>)["payment_transaction_id"] ??
      undefined;

    console.log(`[Webhook] Received order — Entry ID: ${entryId}`);

    // Process the order through the orchestrator
    const result = await processOrder(payload, entryId, ewayTransactionId);

    if (result.success) {
      console.log(`[Webhook] Order processed successfully — ${result.status}`);
      return NextResponse.json(
        {
          success: true,
          orderId: result.orderId,
          status: result.status,
          warnings: result.warnings,
        },
        { status: 200 }
      );
    } else {
      console.error(`[Webhook] Order processing failed:`, result.errors);
      return NextResponse.json(
        {
          success: false,
          orderId: result.orderId,
          status: result.status,
          errors: result.errors,
          warnings: result.warnings,
        },
        { status: 422 }
      );
    }
  } catch (err) {
    console.error("[Webhook] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Health check
export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "marmoset-hub",
    endpoint: "gravity-forms-webhook",
  });
}
