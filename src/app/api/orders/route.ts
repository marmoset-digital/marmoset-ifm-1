// ===========================================
// API: LIST ORDERS
// ===========================================
// GET /api/orders
//
// Returns all orders with their sync statuses.
// Query params: ?status=completed&limit=50&offset=0
// Phase 2: This powers the dashboard.

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const limit = parseInt(url.searchParams.get("limit") ?? "50");
    const offset = parseInt(url.searchParams.get("offset") ?? "0");

    let query = supabase
      .from("orders")
      .select(
        `
        id,
        unique_code,
        status,
        total_amount,
        payment_method,
        created_at,
        updated_at,
        payments (id, status, method, eway_txn_id),
        jobs (id, status, sm8_job_id),
        invoices (id, status, xero_invoice_id)
      `,
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error, count } = await query;

    if (error) {
      throw error;
    }

    return NextResponse.json({
      orders: data,
      total: count,
      limit,
      offset,
    });
  } catch (err) {
    console.error("[Orders API] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch orders" },
      { status: 500 }
    );
  }
}
