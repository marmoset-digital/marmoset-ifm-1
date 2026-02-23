// ===========================================
// API: CONFIRM BANK TRANSFER PAYMENT
// ===========================================
// POST /api/webhooks/eway
//
// Also serves as a manual endpoint to confirm bank transfer payments.
// When a bank transfer is confirmed, this triggers the ServiceM8 job
// creation that was deferred at order time.
//
// Body: { "order_id": "uuid", "confirmation_type": "bank_transfer" }

import { NextRequest, NextResponse } from "next/server";
import { confirmBankTransferPayment } from "@/lib/orchestrator";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { order_id, confirmation_type } = body;

    if (!order_id) {
      return NextResponse.json(
        { error: "Missing order_id" },
        { status: 400 }
      );
    }

    if (confirmation_type === "bank_transfer") {
      const result = await confirmBankTransferPayment(order_id);

      if (result.success) {
        return NextResponse.json({
          success: true,
          message: "Bank transfer confirmed — ServiceM8 job created",
        });
      } else {
        return NextResponse.json(
          { success: false, error: result.error },
          { status: 422 }
        );
      }
    }

    return NextResponse.json(
      { error: "Unknown confirmation type" },
      { status: 400 }
    );
  } catch (err) {
    console.error("[Payment Confirmation] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
