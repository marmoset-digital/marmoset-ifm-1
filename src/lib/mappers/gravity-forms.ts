// ===========================================
// GRAVITY FORMS → PARSED ORDER MAPPER
// ===========================================
// Maps raw GF webhook field IDs to our structured ParsedOrder type.
// Field IDs reference the Stormwater Services Order Form V1.

import type {
  GravityFormsPayload,
  ParsedOrder,
  OsdTank,
  PipeRun,
  KerbInletPit,
  CustomerRole,
  JobUrgency,
  ServiceType,
  PaymentMethod,
} from "@/types";

/**
 * Safely extract a string value from the GF payload.
 */
function str(payload: GravityFormsPayload, fieldId: string): string {
  return (payload[fieldId] ?? "").trim();
}

/**
 * Safely extract a numeric value from the GF payload.
 * GF sends prices as strings like "$5,000.00" or "5000" — we handle both.
 */
function num(payload: GravityFormsPayload, fieldId: string): number {
  const raw = str(payload, fieldId);
  if (!raw) return 0;
  const cleaned = raw.replace(/[$,\s]/g, "");
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Parse a GF product field (returns name, price, quantity).
 * Product fields use sub-IDs: {id}.1 = name, {id}.2 = price, {id}.3 = quantity
 */
function product(payload: GravityFormsPayload, fieldId: number) {
  const name = str(payload, `${fieldId}.1`);
  const price = num(payload, `${fieldId}.2`);
  const quantity = num(payload, `${fieldId}.3`);

  if (!name && price === 0 && quantity === 0) return null;

  return { name, price, quantity };
}

/**
 * Parse OSD tank configuration.
 */
function parseOsdTanks(payload: GravityFormsPayload): OsdTank[] {
  const tanks: OsdTank[] = [];

  // Tank 1 (fields 21-24)
  const tank1Length = str(payload, "21");
  if (tank1Length) {
    tanks.push({
      tankNumber: 1,
      length: tank1Length,
      width: str(payload, "22"),
      height: str(payload, "23"),
      price: num(payload, "24.2"),
    });
  }

  // Tank 2 (fields 88-93) — only if user selected "Yes" for 2nd tank
  const needsSecondTank = str(payload, "88");
  if (needsSecondTank === "Yes") {
    tanks.push({
      tankNumber: 2,
      length: str(payload, "90"),
      width: str(payload, "91"),
      height: str(payload, "92"),
      price: num(payload, "93.2"),
    });
  }

  return tanks;
}

/**
 * Parse piping runs (up to 5).
 * Width fields: 108, 110, 112, 114, 116
 * Product fields: 109, 111, 113, 115, 117
 */
function parsePiping(payload: GravityFormsPayload): PipeRun[] {
  const numPipes = parseInt(str(payload, "107")) || 0;

  const pipeConfig = [
    { widthField: "108", productField: 109 },
    { widthField: "110", productField: 111 },
    { widthField: "112", productField: 113 },
    { widthField: "114", productField: 115 },
    { widthField: "116", productField: 117 },
  ];

  const pipes: PipeRun[] = [];

  for (let i = 0; i < numPipes && i < pipeConfig.length; i++) {
    const config = pipeConfig[i];
    const width = str(payload, config.widthField);
    const prod = product(payload, config.productField);

    if (width && prod) {
      pipes.push({
        pipeNumber: i + 1,
        width,
        lengthMetres: prod.quantity,
        pricePerMetre: prod.price,
        totalPrice: prod.price * prod.quantity,
      });
    }
  }

  return pipes;
}

/**
 * Parse kerb inlet pits (up to 4).
 * Depth fields: 97, 100, 102, 104
 * Product fields: 99, 101, 103, 105
 */
function parseKerbInletPits(payload: GravityFormsPayload): KerbInletPit[] {
  const numPits = parseInt(str(payload, "96")) || 0;
  if (numPits === 0) return [];

  const pitConfig = [
    { depthField: "97", productField: 99 },
    { depthField: "100", productField: 101 },
    { depthField: "102", productField: 103 },
    { depthField: "104", productField: 105 },
  ];

  const pits: KerbInletPit[] = [];

  for (let i = 0; i < numPits && i < pitConfig.length; i++) {
    const config = pitConfig[i];
    const depth = str(payload, config.depthField);
    const prod = product(payload, config.productField);

    if (depth && prod) {
      pits.push({
        pitNumber: i + 1,
        installationDepth: depth,
        price: prod.price,
      });
    }
  }

  return pits;
}

/**
 * Main mapper: converts raw Gravity Forms payload into a structured ParsedOrder.
 */
export function mapGravityFormsToOrder(
  payload: GravityFormsPayload,
  entryId: string
): ParsedOrder {
  return {
    uniqueId: str(payload, "1"),
    gravityFormEntryId: entryId,

    customer: {
      firstName: str(payload, "4.3"),
      lastName: str(payload, "4.6"),
      email: str(payload, "5"),
      phone: str(payload, "6"),
      role: str(payload, "7") as CustomerRole,
      fullName: str(payload, "106"),
    },

    jobLocation: {
      street: str(payload, "8.1"),
      street2: str(payload, "8.2"),
      city: str(payload, "8.3"),
      state: str(payload, "8.4") || "NSW",
      postcode: str(payload, "8.5"),
      country: str(payload, "8.6") || "Australia",
    },

    billing: {
      name: str(payload, "11"),
      street: str(payload, "12.1"),
      street2: str(payload, "12.2"),
      city: str(payload, "12.3"),
      state: str(payload, "12.4") || "NSW",
      postcode: str(payload, "12.5"),
      country: str(payload, "12.6") || "Australia",
    },

    jobDetails: {
      urgency: str(payload, "9") as JobUrgency,
      siteAccessNotes: str(payload, "10"),
      referralSource: str(payload, "13"),
      referralName: str(payload, "14") || str(payload, "15"),
      hydraulicEngineerName: str(payload, "86"),
      hydraulicEngineerPhone: str(payload, "87"),
      serviceType: str(payload, "17") as ServiceType,
      generalLocation: str(payload, "67"),
      rockOrSandAccepted: str(payload, "81") === "I Accept",
      exclusionsAccepted: str(payload, "80") === "I Accept All Exclusions Listed Below",
      termsAccepted: str(payload, "79.1") !== "",
    },

    osdTanks: parseOsdTanks(payload),
    piping: parsePiping(payload),

    addOns: {
      drivewayFinish: {
        required: str(payload, "28") as "No" | "Yes (1 of them)" | "Yes (2 of them)",
        price: num(payload, "41.2"),
      },
      grates: {
        required: str(payload, "94") as "No" | "Yes - Load Rating Class C" | "Yes - Load Rating Class D",
        price: str(payload, "94").includes("Class D")
          ? num(payload, "29.2")
          : num(payload, "31.2"),
      },
      stepIrons: product(payload, 32),
      meshAndOrificePlates: {
        required: str(payload, "95") as "No" | "Yes - Just One (1)" | "Yes - Two (2) in Total",
        price: num(payload, "30.2"),
      },
      pipeToStreet: {
        required: str(payload, "25") === "Yes",
        length: str(payload, "26"),
        price: num(payload, "39.2"),
      },
      kerbInletPits: parseKerbInletPits(payload),
      headWall: str(payload, "49") === "Yes" ? product(payload, 50) : null,
    },

    pricing: {
      subtotal: num(payload, "65"),
      areaLoading: num(payload, "73.2"),
      subtotalWithLoading: num(payload, "70"),
      gst: num(payload, "74.2"),
      couponCode: str(payload, "77"),
      total: num(payload, "72"),
    },

    payment: {
      method: str(payload, "84") as PaymentMethod,
    },
  };
}
