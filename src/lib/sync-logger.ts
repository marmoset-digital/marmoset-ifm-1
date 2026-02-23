// ===========================================
// SYNC LOGGER
// ===========================================
// Records every external API call for audit and debugging.

import { supabase } from "@/lib/supabase";
import type { SyncService, SyncStatus } from "@/types";

export async function logSync(params: {
  orderId: string;
  service: SyncService;
  action: string;
  requestPayload?: Record<string, unknown>;
  responsePayload?: Record<string, unknown>;
  status: SyncStatus;
  errorMessage?: string;
}) {
  const { error } = await supabase.from("sync_logs").insert({
    order_id: params.orderId,
    service: params.service,
    action: params.action,
    request_payload: params.requestPayload ?? null,
    response_payload: params.responsePayload ?? null,
    status: params.status,
    error_message: params.errorMessage ?? null,
  });

  if (error) {
    console.error("[SyncLogger] Failed to write sync log:", error);
  }
}

/**
 * Wrapper that logs a service call automatically.
 * Logs the request before, and the response/error after.
 */
export async function withSyncLogging<T>(
  params: {
    orderId: string;
    service: SyncService;
    action: string;
    requestPayload?: Record<string, unknown>;
  },
  fn: () => Promise<T>
): Promise<T> {
  try {
    const result = await fn();

    await logSync({
      ...params,
      responsePayload: result as Record<string, unknown>,
      status: "success",
    });

    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    await logSync({
      ...params,
      status: "failed",
      errorMessage,
    });

    throw err;
  }
}
