// ===========================================
// ORDER ORCHESTRATOR
// ===========================================
// The heart of the Marmoset Integration Engine.
// Coordinates the full order flow:
//   1. Validate order
//   2. Save to database
//   3. Process payment (credit card) or mark as pending (bank transfer)
//   4. Sync to ServiceM8 (only if payment confirmed)
//   5. Sync to Xero
//
// Each step is independent with its own error handling.

import { supabase } from "@/lib/supabase";
import { mapGravityFormsToOrder } from "@/lib/mappers/gravity-forms";
import { validateOrder } from "@/lib/validators/order";
import { processPayment } from "@/lib/services/eway";
import { syncToServiceM8 } from "@/lib/services/servicem8";
import { syncToXero } from "@/lib/services/xero";
import type { GravityFormsPayload, OrderStatus } from "@/types";

export interface OrchestrationResult {
  success: boolean;
  orderId: string | null;
  status: OrderStatus;
  errors: string[];
  warnings: string[];
  details: {
    payment?: { success: boolean; transactionId?: string | null };
    servicem8?: { companyUuid?: string; jobUuid?: string };
    xero?: { contactId?: string; invoiceId?: string };
  };
}

/**
 * Update the order status in the database.
 */
async function updateOrderStatus(orderId: string, status: OrderStatus) {
  const { error } = await supabase
    .from("orders")
    .update({ status })
    .eq("id", orderId);

  if (error) {
    console.error(`[Orchestrator] Failed to update order ${orderId} status to ${status}:`, error);
  }
}

/**
 * Main orchestration function — processes a complete order.
 */
export async function processOrder(
  payload: GravityFormsPayload,
  entryId: string,
  ewayTransactionId?: string
): Promise<OrchestrationResult> {
  const result: OrchestrationResult = {
    success: false,
    orderId: null,
    status: "received",
    errors: [],
    warnings: [],
    details: {},
  };

  // -----------------------------------------------
  // STEP 1: Parse and validate
  // -----------------------------------------------
  let order;
  try {
    order = mapGravityFormsToOrder(payload, entryId);
  } catch (err) {
    result.errors.push(`Failed to parse form data: ${err instanceof Error ? err.message : String(err)}`);
    result.status = "failed";
    return result;
  }

  const validation = validateOrder(order);
  result.warnings = validation.warnings;

  if (!validation.valid) {
    result.errors = validation.errors;
    result.status = "failed";
    return result;
  }

  // -----------------------------------------------
  // STEP 2: Save to database
  // -----------------------------------------------
  let orderId: string;
  try {
    const { data, error } = await supabase
      .from("orders")
      .insert({
        gravity_form_entry_id: entryId,
        unique_code: order.uniqueId,
        raw_payload: payload,
        parsed_data: order,
        status: "received",
        total_amount: order.pricing.total,
        payment_method: order.payment.method,
      })
      .select("id")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to insert order");
    }

    orderId = data.id;
    result.orderId = orderId;

    console.log(`[Orchestrator] Order saved: ${orderId} (${order.uniqueId})`);
  } catch (err) {
    result.errors.push(`Database error: ${err instanceof Error ? err.message : String(err)}`);
    result.status = "failed";
    return result;
  }

  // -----------------------------------------------
  // STEP 3: Process payment
  // -----------------------------------------------
  let paymentConfirmed = false;

  if (order.payment.method === "Credit Card") {
    try {
      await updateOrderStatus(orderId, "payment_processing");

      const paymentResult = await processPayment(orderId, order, ewayTransactionId);

      // Save payment record
      await supabase.from("payments").insert({
        order_id: orderId,
        eway_txn_id: paymentResult.transactionId,
        amount: order.pricing.total,
        status: paymentResult.success ? "success" : "failed",
        method: "Credit Card",
        error_message: paymentResult.errorMessage,
      });

      if (paymentResult.success) {
        paymentConfirmed = true;
        result.details.payment = {
          success: true,
          transactionId: paymentResult.transactionId,
        };
        await updateOrderStatus(orderId, "payment_completed");
        console.log(`[Orchestrator] Payment confirmed: ${paymentResult.transactionId}`);
      } else {
        result.details.payment = { success: false };
        result.errors.push(`Payment failed: ${paymentResult.errorMessage}`);
        await updateOrderStatus(orderId, "payment_failed");
        // STOP HERE — do not create job or invoice if payment failed
        result.status = "payment_failed";
        return result;
      }
    } catch (err) {
      result.errors.push(`Payment error: ${err instanceof Error ? err.message : String(err)}`);
      await updateOrderStatus(orderId, "payment_failed");
      result.status = "payment_failed";
      return result;
    }
  } else {
    // Bank transfer — mark as pending, do NOT proceed to ServiceM8
    await supabase.from("payments").insert({
      order_id: orderId,
      amount: order.pricing.total,
      status: "pending",
      method: order.payment.method,
    });

    await updateOrderStatus(orderId, "payment_pending");
    result.details.payment = { success: false };

    console.log(`[Orchestrator] Bank transfer order — waiting for payment (${order.uniqueId})`);

    // For bank transfers, we still create the Xero invoice (as DRAFT)
    // but do NOT create the ServiceM8 job until payment is confirmed.
    try {
      await updateOrderStatus(orderId, "syncing_xero");
      const xeroResult = await syncToXero(orderId, order, false);

      await supabase.from("invoices").insert({
        order_id: orderId,
        xero_invoice_id: xeroResult.invoiceId,
        xero_contact_id: xeroResult.contactId,
        amount: order.pricing.total,
        status: "success",
      });

      result.details.xero = xeroResult;
      console.log(`[Orchestrator] Xero draft invoice created for bank transfer order`);
    } catch (err) {
      result.warnings.push(`Xero sync failed (will retry): ${err instanceof Error ? err.message : String(err)}`);
    }

    result.status = "payment_pending";
    result.success = true; // Order received successfully, just awaiting payment
    return result;
  }

  // -----------------------------------------------
  // STEP 4: Sync to ServiceM8 (only for confirmed payments)
  // -----------------------------------------------
  try {
    await updateOrderStatus(orderId, "syncing_servicem8");
    const sm8Result = await syncToServiceM8(orderId, order);

    await supabase.from("jobs").insert({
      order_id: orderId,
      sm8_job_id: sm8Result.jobUuid,
      sm8_client_id: sm8Result.companyUuid,
      status: "success",
    });

    result.details.servicem8 = sm8Result;
    console.log(`[Orchestrator] ServiceM8 job created: ${sm8Result.jobUuid}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    result.warnings.push(`ServiceM8 sync failed (will retry): ${errorMsg}`);

    await supabase.from("jobs").insert({
      order_id: orderId,
      status: "failed",
      error_message: errorMsg,
    });
  }

  // -----------------------------------------------
  // STEP 5: Sync to Xero
  // -----------------------------------------------
  try {
    await updateOrderStatus(orderId, "syncing_xero");
    const xeroResult = await syncToXero(orderId, order, paymentConfirmed);

    await supabase.from("invoices").insert({
      order_id: orderId,
      xero_invoice_id: xeroResult.invoiceId,
      xero_contact_id: xeroResult.contactId,
      amount: order.pricing.total,
      status: "success",
    });

    result.details.xero = xeroResult;
    console.log(`[Orchestrator] Xero invoice created: ${xeroResult.invoiceId}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    result.warnings.push(`Xero sync failed (will retry): ${errorMsg}`);

    await supabase.from("invoices").insert({
      order_id: orderId,
      amount: order.pricing.total,
      status: "failed",
      error_message: errorMsg,
    });
  }

  // -----------------------------------------------
  // FINAL: Determine overall status
  // -----------------------------------------------
  const hasServicem8 = !!result.details.servicem8?.jobUuid;
  const hasXero = !!result.details.xero?.invoiceId;

  if (hasServicem8 && hasXero) {
    result.status = "completed";
    result.success = true;
  } else if (hasServicem8 || hasXero) {
    result.status = "partial_failure";
    result.success = true; // Partially succeeded
  } else {
    result.status = "failed";
    result.success = false;
  }

  await updateOrderStatus(orderId, result.status);
  console.log(`[Orchestrator] Order ${order.uniqueId} — Final status: ${result.status}`);

  return result;
}

/**
 * Process a bank transfer payment confirmation.
 * Called when the bank transfer is confirmed (manually or via webhook).
 * This triggers the ServiceM8 job creation that was deferred.
 */
export async function confirmBankTransferPayment(
  orderId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Fetch the order
    const { data: order, error: fetchError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single();

    if (fetchError || !order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    if (order.status !== "payment_pending") {
      throw new Error(`Order is not in payment_pending status (current: ${order.status})`);
    }

    // Update payment status
    await supabase
      .from("payments")
      .update({ status: "success" })
      .eq("order_id", orderId);

    await updateOrderStatus(orderId, "payment_completed");

    // Now create the ServiceM8 job
    const parsedOrder = order.parsed_data;

    await updateOrderStatus(orderId, "syncing_servicem8");
    const sm8Result = await syncToServiceM8(orderId, parsedOrder);

    await supabase.from("jobs").insert({
      order_id: orderId,
      sm8_job_id: sm8Result.jobUuid,
      sm8_client_id: sm8Result.companyUuid,
      status: "success",
    });

    // Update Xero invoice from DRAFT to AUTHORISED
    const { data: invoice } = await supabase
      .from("invoices")
      .select("xero_invoice_id")
      .eq("order_id", orderId)
      .single();

    if (invoice?.xero_invoice_id) {
      // TODO: Update Xero invoice status to AUTHORISED
      // and record the payment
      console.log(`[Orchestrator] TODO: Update Xero invoice ${invoice.xero_invoice_id} to AUTHORISED`);
    }

    await updateOrderStatus(orderId, "completed");
    console.log(`[Orchestrator] Bank transfer confirmed for order ${orderId} — job created`);

    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Orchestrator] Bank transfer confirmation failed:`, errorMsg);
    return { success: false, error: errorMsg };
  }
}
