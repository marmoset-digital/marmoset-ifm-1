// ===========================================
// MARMOSET HUB - Core Type Definitions
// ===========================================
// Based on Gravity Forms export: Stormwater Services Order Form V1 (87 fields)

// --- Gravity Forms Webhook Payload ---

export interface GravityFormsPayload {
  // The raw form entry from the webhook
  // Keys are field IDs as strings (e.g. "1", "4.3", "8.1")
  [fieldId: string]: string | undefined;
}

// --- Parsed Order (structured from raw GF payload) ---

export interface ParsedOrder {
  // Identifiers
  uniqueId: string;           // Field 1 — e.g. "SW100"
  gravityFormEntryId: string; // GF entry ID from webhook metadata

  // Customer Details
  customer: {
    firstName: string;        // Field 4.3
    lastName: string;         // Field 4.6
    email: string;            // Field 5
    phone: string;            // Field 6
    role: CustomerRole;       // Field 7
    fullName: string;         // Field 106 (signature/confirmation name)
  };

  // Job Location
  jobLocation: {
    street: string;           // Field 8.1
    street2: string;          // Field 8.2
    city: string;             // Field 8.3
    state: string;            // Field 8.4 (default: NSW)
    postcode: string;         // Field 8.5
    country: string;          // Field 8.6 (default: Australia)
  };

  // Billing
  billing: {
    name: string;             // Field 11
    street: string;           // Field 12.1
    street2: string;          // Field 12.2
    city: string;             // Field 12.3
    state: string;            // Field 12.4
    postcode: string;         // Field 12.5
    country: string;          // Field 12.6
  };

  // Job Details
  jobDetails: {
    urgency: JobUrgency;                  // Field 9
    siteAccessNotes: string;              // Field 10
    referralSource: string;               // Field 13
    referralName: string;                 // Field 14 or 15
    hydraulicEngineerName: string;        // Field 86
    hydraulicEngineerPhone: string;       // Field 87
    serviceType: ServiceType;             // Field 17
    generalLocation: string;              // Field 67
    rockOrSandAccepted: boolean;          // Field 81
    exclusionsAccepted: boolean;          // Field 80
    termsAccepted: boolean;               // Field 79
  };

  // OSD Tank Configuration
  osdTanks: OsdTank[];

  // Stormwater Easement Piping
  piping: PipeRun[];

  // Add-ons
  addOns: {
    drivewayFinish: DrivewayFinish;
    grates: GrateOption;
    stepIrons: ProductLineItem | null;
    meshAndOrificePlates: MeshPlateOption;
    pipeToStreet: PipeToStreet;
    kerbInletPits: KerbInletPit[];
    headWall: ProductLineItem | null;
  };

  // Pricing
  pricing: {
    subtotal: number;         // Field 65
    areaLoading: number;      // Field 73
    subtotalWithLoading: number; // Field 70
    gst: number;              // Field 74
    couponCode: string;       // Field 77
    total: number;            // Field 72
  };

  // Payment
  payment: {
    method: PaymentMethod;    // Field 84
  };
}

// --- Enums & Unions ---

export type CustomerRole = "Owner" | "Builder" | "Architect" | "Other";

export type JobUrgency = "Immediately" | "Within 1 Week" | "Within 1 Month";

export type ServiceType =
  | "OSD Tank (which includes the pipe to street option)"
  | "Stormwater Easement (in roadway and property)"
  | "OSD + Stormwater Easement Pipes (full service)";

export type PaymentMethod = "Credit Card" | "Cheque" | "Bank Transfer";

// --- Product / Line Item Types ---

export interface ProductLineItem {
  name: string;
  price: number;
  quantity: number;
}

export interface OsdTank {
  tankNumber: 1 | 2;
  length: string;   // e.g. "A: 1-6m"
  width: string;    // e.g. "B: 3-5m"
  height: string;   // e.g. "A: 0-1.5m"
  price: number;
}

export interface PipeRun {
  pipeNumber: number;        // 1-5
  width: string;             // e.g. "225 mm (PVC)"
  lengthMetres: number;      // quantity in linear metres
  pricePerMetre: number;
  totalPrice: number;
}

export interface DrivewayFinish {
  required: "No" | "Yes (1 of them)" | "Yes (2 of them)";
  price: number;
}

export interface GrateOption {
  required: "No" | "Yes - Load Rating Class C" | "Yes - Load Rating Class D";
  price: number;
}

export interface MeshPlateOption {
  required: "No" | "Yes - Just One (1)" | "Yes - Two (2) in Total";
  price: number;
}

export interface PipeToStreet {
  required: boolean;
  length: string;    // e.g. "6 - 12m"
  price: number;
}

export interface KerbInletPit {
  pitNumber: number;         // 1-4
  installationDepth: string; // e.g. "0.0-1.5m"
  price: number;
}

// --- Database Models ---

export type OrderStatus =
  | "received"               // Webhook received, validated
  | "payment_processing"     // eWAY charge initiated
  | "payment_completed"      // Credit card charged successfully
  | "payment_pending"        // Bank transfer — waiting for funds
  | "payment_failed"         // eWAY charge failed
  | "syncing_servicem8"      // Creating job in ServiceM8
  | "syncing_xero"           // Creating invoice in Xero
  | "completed"              // All syncs successful
  | "partial_failure"        // Some syncs failed (check sync_logs)
  | "failed";                // Critical failure

export type SyncService = "eway" | "servicem8" | "xero";
export type SyncStatus = "pending" | "in_progress" | "success" | "failed" | "retrying";

export interface DbOrder {
  id: string;                // UUID
  gravity_form_entry_id: string;
  unique_code: string;       // e.g. "SW100"
  raw_payload: GravityFormsPayload;
  parsed_data: ParsedOrder;
  status: OrderStatus;
  total_amount: number;
  payment_method: PaymentMethod;
  created_at: string;
  updated_at: string;
}

export interface DbJob {
  id: string;
  order_id: string;
  sm8_job_id: string | null;
  sm8_client_id: string | null;
  status: SyncStatus;
  synced_at: string | null;
  error_message: string | null;
}

export interface DbInvoice {
  id: string;
  order_id: string;
  xero_invoice_id: string | null;
  xero_contact_id: string | null;
  amount: number;
  status: SyncStatus;
  synced_at: string | null;
  error_message: string | null;
}

export interface DbPayment {
  id: string;
  order_id: string;
  eway_txn_id: string | null;
  amount: number;
  status: SyncStatus;
  method: PaymentMethod;
  error_message: string | null;
  created_at: string;
}

export interface DbSyncLog {
  id: string;
  order_id: string;
  service: SyncService;
  action: string;
  request_payload: Record<string, unknown> | null;
  response_payload: Record<string, unknown> | null;
  status: SyncStatus;
  error_message: string | null;
  created_at: string;
}
