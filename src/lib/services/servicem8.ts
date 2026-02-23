// ===========================================
// SERVICEM8 SERVICE
// ===========================================
// Creates companies (clients) and jobs in ServiceM8.
// Docs: https://developer.servicem8.com/docs/

import { withSyncLogging } from "@/lib/sync-logger";
import {
  buildSm8CompanyPayload,
  buildSm8JobPayload,
  buildSm8MaterialsList,
} from "@/lib/mappers/servicem8";
import type { ParsedOrder } from "@/types";

const SM8_BASE_URL = "https://api.servicem8.com/api_1.0";
const SM8_ACCESS_TOKEN = process.env.SERVICEM8_ACCESS_TOKEN!;

/**
 * Make an authenticated request to ServiceM8.
 */
async function sm8Request(
  path: string,
  method: "GET" | "POST" | "PUT" = "GET",
  body?: Record<string, unknown>
) {
  const response = await fetch(`${SM8_BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SM8_ACCESS_TOKEN}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ServiceM8 API error (${response.status}): ${errorText}`);
  }

  // ServiceM8 POST returns the UUID in the x-record-uuid header
  if (method === "POST") {
    const uuid = response.headers.get("x-record-uuid");
    return { uuid, status: response.status };
  }

  return response.json();
}

/**
 * Search for an existing company by email to avoid duplicates.
 */
async function findCompanyByEmail(email: string): Promise<string | null> {
  try {
    const result = await sm8Request(
      `/company.json?%24filter=email%20eq%20'${encodeURIComponent(email)}'`
    );

    if (Array.isArray(result) && result.length > 0) {
      return result[0].uuid;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Create or find a company (client) in ServiceM8.
 */
export async function createOrFindCompany(
  orderId: string,
  order: ParsedOrder
): Promise<string> {
  const payload = buildSm8CompanyPayload(order);

  return withSyncLogging(
    {
      orderId,
      service: "servicem8",
      action: "create_or_find_company",
      requestPayload: payload,
    },
    async () => {
      // Check for existing company first
      const existingUuid = await findCompanyByEmail(order.customer.email);
      if (existingUuid) {
        console.log(`[ServiceM8] Found existing company: ${existingUuid}`);
        return existingUuid;
      }

      // Create new company
      const result = await sm8Request("/company.json", "POST", payload);
      if (!result.uuid) {
        throw new Error("ServiceM8 did not return a company UUID");
      }

      console.log(`[ServiceM8] Created new company: ${result.uuid}`);
      return result.uuid;
    }
  );
}

/**
 * Create a job in ServiceM8.
 */
export async function createJob(
  orderId: string,
  order: ParsedOrder,
  companyUuid: string
): Promise<string> {
  const payload = buildSm8JobPayload(order, companyUuid);

  return withSyncLogging(
    {
      orderId,
      service: "servicem8",
      action: "create_job",
      requestPayload: payload as Record<string, unknown>,
    },
    async () => {
      const result = await sm8Request("/job.json", "POST", payload);
      if (!result.uuid) {
        throw new Error("ServiceM8 did not return a job UUID");
      }

      console.log(`[ServiceM8] Created job: ${result.uuid}`);

      // Add materials as job notes/attachments
      const materials = buildSm8MaterialsList(order);
      if (materials.length > 0) {
        try {
          await sm8Request("/jobnote.json", "POST", {
            job_uuid: result.uuid,
            note: `MATERIALS LIST:\n${materials.map((m) => `• ${m}`).join("\n")}`,
          });
        } catch (err) {
          // Non-critical — log but don't fail the job creation
          console.warn("[ServiceM8] Failed to add materials note:", err);
        }
      }

      return result.uuid;
    }
  );
}

/**
 * Full ServiceM8 sync: create company + job.
 */
export async function syncToServiceM8(
  orderId: string,
  order: ParsedOrder
): Promise<{ companyUuid: string; jobUuid: string }> {
  const companyUuid = await createOrFindCompany(orderId, order);
  const jobUuid = await createJob(orderId, order, companyUuid);

  return { companyUuid, jobUuid };
}
