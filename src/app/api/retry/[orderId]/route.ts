// ===========================================
// API: RETRY FAILED SYNC
// ===========================================
// POST /api/retry/[orderId]
//
// Retries failed ServiceM8 or Xero syncs for a specific order.
// Query param: ?service=servicem8|xero

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { syncToServiceM8 } from "@/lib/services/servicem8";
import { syncToXero } from "@/lib/services/xero";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  try {
    const { orderId } = params;
    const url = new URL(request.url);
    const service = url.searchParams.get("service");

    if (!service || !["servicem8", "xero"].includes(service)) {
      return NextResponse.json(
        { error: "Specify ?service=servicem8 or ?service=xero" },
        { status: 400 }
      );
    }

    // Fetch the order
    const { data: order, error } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single();

    if (error || !order) {
      return NextResponse.json(
        { error: "Order not found" },
        { status: 404 }
      );
    }

    const parsedOrder = order.parsed_data;

    if (service === "servicem8") {
      // Only retry if payment is confirmed
      if (
        order.status === "payment_pending" ||
        order.status === "payment_failed"
      ) {
        return NextResponse.json(
          { error: "Cannot create ServiceM8 job — payment not confirmed" },
          { status: 422 }
        );
      }

      const result = await syncToServiceM8(orderId, parsedOrder);

      await supabase
        .from("jobs")
        .update({
          sm8_job_id: result.jobUuid,
          sm8_client_id: result.companyUuid,
          status: "success",
          error_message: null,
          synced_at: new Date().toISOString(),
        })
        .eq("order_id", orderId);

      return NextResponse.json({
        success: true,
        service: "servicem8",
        jobUuid: result.jobUuid,
      });
    }

    if (service === "xero") {
      const paymentConfirmed =
        order.status !== "payment_pending" &&
        order.payment_method === "Credit Card";

      const result = await syncToXero(orderId, parsedOrder, paymentConfirmed);

      await supabase
        .from("invoices")
        .update({
          xero_invoice_id: result.invoiceId,
          xero_contact_id: result.contactId,
          status: "success",
          error_message: null,
          synced_at: new Date().toISOString(),
        })
        .eq("order_id", orderId);

      return NextResponse.json({
        success: true,
        service: "xero",
        invoiceId: result.invoiceId,
      });
    }
  } catch (err) {
    console.error("[Retry] Error:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Retry failed",
      },
      { status: 500 }
    );
  }
}
