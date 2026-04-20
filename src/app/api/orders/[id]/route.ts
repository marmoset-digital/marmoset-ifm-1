// ===========================================
// API: ORDER DETAIL
// ===========================================
// GET /api/orders/[id]
//
// Returns a single order with all related data and sync logs.

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    const { data, error } = await supabase
      .from("orders")
      .select(
        `
        *,
        payments (*),
        jobs (*),
        invoices (*),
        sync_logs (*)
      `
      )
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: "Order not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ order: data });
  } catch (err) {
    console.error("[Order Detail] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch order" },
      { status: 500 }
    );
  }
}
