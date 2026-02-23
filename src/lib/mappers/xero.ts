// ===========================================
// PARSED ORDER → XERO MAPPER
// ===========================================
// Maps our structured ParsedOrder into Xero API payloads
// for creating contacts and draft invoices.

import type { ParsedOrder } from "@/types";

interface XeroLineItem {
  Description: string;
  Quantity: number;
  UnitAmount: number;
  AccountCode: string;   // Revenue account code — adjust to match your Xero chart of accounts
  TaxType: string;
}

/**
 * Build the Xero contact payload.
 */
export function buildXeroContactPayload(order: ParsedOrder) {
  return {
    Name: order.billing.name || `${order.customer.firstName} ${order.customer.lastName}`,
    FirstName: order.customer.firstName,
    LastName: order.customer.lastName,
    EmailAddress: order.customer.email,
    Phones: [
      {
        PhoneType: "MOBILE",
        PhoneNumber: order.customer.phone,
      },
    ],
    Addresses: [
      {
        AddressType: "STREET",
        AddressLine1: order.billing.street,
        AddressLine2: order.billing.street2,
        City: order.billing.city,
        Region: order.billing.state,
        PostalCode: order.billing.postcode,
        Country: order.billing.country,
      },
    ],
  };
}

/**
 * Build itemised Xero invoice line items from the order.
 * All amounts are GST-exclusive (Xero calculates GST based on TaxType).
 */
export function buildXeroLineItems(order: ParsedOrder): XeroLineItem[] {
  const lines: XeroLineItem[] = [];
  const revenueAccount = "200"; // Adjust to your Xero revenue account code

  // OSD Tanks
  for (const tank of order.osdTanks) {
    lines.push({
      Description: `OSD Tank ${tank.tankNumber} — ${tank.length} × ${tank.width} × ${tank.height}`,
      Quantity: 1,
      UnitAmount: tank.price,
      AccountCode: revenueAccount,
      TaxType: "OUTPUT",
    });
  }

  // Piping runs
  for (const pipe of order.piping) {
    lines.push({
      Description: `Stormwater Pipe Run ${pipe.pipeNumber} — ${pipe.width}`,
      Quantity: pipe.lengthMetres,
      UnitAmount: pipe.pricePerMetre,
      AccountCode: revenueAccount,
      TaxType: "OUTPUT",
    });
  }

  // Driveway finish
  if (order.addOns.drivewayFinish.required !== "No") {
    lines.push({
      Description: `Driveway Finish (${order.addOns.drivewayFinish.required})`,
      Quantity: 1,
      UnitAmount: order.addOns.drivewayFinish.price,
      AccountCode: revenueAccount,
      TaxType: "OUTPUT",
    });
  }

  // Grates
  if (order.addOns.grates.required !== "No") {
    lines.push({
      Description: `Grates — ${order.addOns.grates.required}`,
      Quantity: 1,
      UnitAmount: order.addOns.grates.price,
      AccountCode: revenueAccount,
      TaxType: "OUTPUT",
    });
  }

  // Step irons
  if (order.addOns.stepIrons) {
    lines.push({
      Description: "Step Irons",
      Quantity: order.addOns.stepIrons.quantity,
      UnitAmount: order.addOns.stepIrons.price,
      AccountCode: revenueAccount,
      TaxType: "OUTPUT",
    });
  }

  // Mesh & orifice plates
  if (order.addOns.meshAndOrificePlates.required !== "No") {
    lines.push({
      Description: `Mesh & Orifice Plate(s) — ${order.addOns.meshAndOrificePlates.required}`,
      Quantity: 1,
      UnitAmount: order.addOns.meshAndOrificePlates.price,
      AccountCode: revenueAccount,
      TaxType: "OUTPUT",
    });
  }

  // Pipe to street
  if (order.addOns.pipeToStreet.required) {
    lines.push({
      Description: `Pipe to Street — ${order.addOns.pipeToStreet.length}`,
      Quantity: 1,
      UnitAmount: order.addOns.pipeToStreet.price,
      AccountCode: revenueAccount,
      TaxType: "OUTPUT",
    });
  }

  // Kerb inlet pits
  for (const pit of order.addOns.kerbInletPits) {
    lines.push({
      Description: `Kerb Inlet Pit ${pit.pitNumber} — Depth: ${pit.installationDepth}`,
      Quantity: 1,
      UnitAmount: pit.price,
      AccountCode: revenueAccount,
      TaxType: "OUTPUT",
    });
  }

  // Head wall
  if (order.addOns.headWall) {
    lines.push({
      Description: "Head Wall",
      Quantity: 1,
      UnitAmount: order.addOns.headWall.price,
      AccountCode: revenueAccount,
      TaxType: "OUTPUT",
    });
  }

  // Area loading surcharge
  if (order.pricing.areaLoading > 0) {
    lines.push({
      Description: `Area Loading Surcharge — ${order.jobDetails.generalLocation}`,
      Quantity: 1,
      UnitAmount: order.pricing.areaLoading,
      AccountCode: revenueAccount,
      TaxType: "OUTPUT",
    });
  }

  return lines;
}

/**
 * Build the full Xero invoice payload.
 */
export function buildXeroInvoicePayload(
  order: ParsedOrder,
  xeroContactId: string
) {
  const lineItems = buildXeroLineItems(order);

  // Determine invoice status based on payment method
  const status = order.payment.method === "Credit Card"
    ? "AUTHORISED"    // Paid via eWAY — mark as authorised
    : "DRAFT";        // Bank transfer — stays draft until payment confirmed

  return {
    Type: "ACCREC",              // Accounts Receivable (sales invoice)
    Contact: { ContactID: xeroContactId },
    Status: status,
    Date: new Date().toISOString().split("T")[0],
    DueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0], // 14 day payment terms
    Reference: order.uniqueId,   // e.g. "SW100"
    LineAmountTypes: "Exclusive", // All amounts are GST-exclusive
    LineItems: lineItems,
  };
}
