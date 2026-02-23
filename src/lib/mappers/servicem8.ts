// ===========================================
// PARSED ORDER → SERVICEM8 MAPPER
// ===========================================
// Maps our structured ParsedOrder into ServiceM8 API payloads
// for creating clients and jobs.

import type { ParsedOrder } from "@/types";

/**
 * Maps urgency to a ServiceM8 job status.
 */
function mapUrgencyToStatus(urgency: string): string {
  switch (urgency) {
    case "Immediately":
      return "Quote Approved";
    case "Within 1 Week":
      return "Quote Approved";
    case "Within 1 Month":
      return "Pending";
    default:
      return "Pending";
  }
}

/**
 * Generates the full job description including all specs, materials,
 * and notes for the ServiceM8 job.
 */
function buildJobDescription(order: ParsedOrder): string {
  const lines: string[] = [];

  lines.push(`ORDER: ${order.uniqueId}`);
  lines.push(`SERVICE TYPE: ${order.jobDetails.serviceType}`);
  lines.push(`URGENCY: ${order.jobDetails.urgency}`);
  lines.push("");

  // Hydraulic Engineer
  lines.push("--- HYDRAULIC ENGINEER ---");
  lines.push(`Name: ${order.jobDetails.hydraulicEngineerName}`);
  if (order.jobDetails.hydraulicEngineerPhone) {
    lines.push(`Phone: ${order.jobDetails.hydraulicEngineerPhone}`);
  }
  lines.push("");

  // OSD Tanks
  if (order.osdTanks.length > 0) {
    lines.push("--- OSD TANKS ---");
    for (const tank of order.osdTanks) {
      lines.push(`Tank ${tank.tankNumber}: ${tank.length} × ${tank.width} × ${tank.height} — $${tank.price.toFixed(2)}`);
    }
    lines.push("");
  }

  // Piping
  if (order.piping.length > 0) {
    lines.push("--- STORMWATER EASEMENT PIPING ---");
    for (const pipe of order.piping) {
      lines.push(`Pipe ${pipe.pipeNumber}: ${pipe.width} — ${pipe.lengthMetres}m @ $${pipe.pricePerMetre.toFixed(2)}/m = $${pipe.totalPrice.toFixed(2)}`);
    }
    lines.push("");
  }

  // Add-ons
  lines.push("--- ADD-ONS ---");

  if (order.addOns.drivewayFinish.required !== "No") {
    lines.push(`Driveway Finish: ${order.addOns.drivewayFinish.required} — $${order.addOns.drivewayFinish.price.toFixed(2)}`);
  }

  if (order.addOns.grates.required !== "No") {
    lines.push(`Grates: ${order.addOns.grates.required} — $${order.addOns.grates.price.toFixed(2)}`);
  }

  if (order.addOns.stepIrons) {
    lines.push(`Step Irons: Qty ${order.addOns.stepIrons.quantity} — $${order.addOns.stepIrons.price.toFixed(2)}`);
  }

  if (order.addOns.meshAndOrificePlates.required !== "No") {
    lines.push(`Mesh & Orifice Plates: ${order.addOns.meshAndOrificePlates.required} — $${order.addOns.meshAndOrificePlates.price.toFixed(2)}`);
  }

  if (order.addOns.pipeToStreet.required) {
    lines.push(`Pipe to Street: ${order.addOns.pipeToStreet.length} — $${order.addOns.pipeToStreet.price.toFixed(2)}`);
  }

  if (order.addOns.kerbInletPits.length > 0) {
    for (const pit of order.addOns.kerbInletPits) {
      lines.push(`Kerb Inlet Pit ${pit.pitNumber}: Depth ${pit.installationDepth} — $${pit.price.toFixed(2)}`);
    }
  }

  if (order.addOns.headWall) {
    lines.push(`Head Wall: $${order.addOns.headWall.price.toFixed(2)}`);
  }

  lines.push("");

  // Site access notes
  if (order.jobDetails.siteAccessNotes) {
    lines.push("--- SITE ACCESS ---");
    lines.push(order.jobDetails.siteAccessNotes);
    lines.push("");
  }

  // Pricing summary
  lines.push("--- PRICING ---");
  lines.push(`Subtotal: $${order.pricing.subtotal.toFixed(2)}`);
  lines.push(`Area Loading (${order.jobDetails.generalLocation}): $${order.pricing.areaLoading.toFixed(2)}`);
  lines.push(`GST: $${order.pricing.gst.toFixed(2)}`);
  if (order.pricing.couponCode) {
    lines.push(`Coupon: ${order.pricing.couponCode}`);
  }
  lines.push(`TOTAL: $${order.pricing.total.toFixed(2)}`);
  lines.push(`Payment Method: ${order.payment.method}`);

  return lines.join("\n");
}

/**
 * Build the ServiceM8 company (client) payload.
 */
export function buildSm8CompanyPayload(order: ParsedOrder) {
  return {
    name: order.billing.name || `${order.customer.firstName} ${order.customer.lastName}`,
    email: order.customer.email,
    phone: order.customer.phone,
    address: [
      order.billing.street,
      order.billing.street2,
      order.billing.city,
      order.billing.state,
      order.billing.postcode,
      order.billing.country,
    ]
      .filter(Boolean)
      .join(", "),
  };
}

/**
 * Build the ServiceM8 job payload.
 */
export function buildSm8JobPayload(order: ParsedOrder, companyUuid: string) {
  return {
    company_uuid: companyUuid,
    status: mapUrgencyToStatus(order.jobDetails.urgency),
    job_description: buildJobDescription(order),
    job_address: [
      order.jobLocation.street,
      order.jobLocation.street2,
      order.jobLocation.city,
      order.jobLocation.state,
      order.jobLocation.postcode,
    ]
      .filter(Boolean)
      .join(", "),
    // Custom fields / badges can be added here depending on
    // your ServiceM8 account configuration. Example:
    // badge: "stormwater",
    // category_uuid: "your-category-uuid",
  };
}

/**
 * Build materials list for ServiceM8 job materials/notes.
 */
export function buildSm8MaterialsList(order: ParsedOrder): string[] {
  const materials: string[] = [];

  for (const tank of order.osdTanks) {
    materials.push(`OSD Tank ${tank.tankNumber} (${tank.length} × ${tank.width} × ${tank.height})`);
  }

  for (const pipe of order.piping) {
    materials.push(`Pipe Run ${pipe.pipeNumber}: ${pipe.width} × ${pipe.lengthMetres}m`);
  }

  if (order.addOns.drivewayFinish.required !== "No") {
    materials.push(`Driveway Finish (${order.addOns.drivewayFinish.required})`);
  }

  if (order.addOns.grates.required !== "No") {
    materials.push(`Grates (${order.addOns.grates.required})`);
  }

  if (order.addOns.stepIrons) {
    materials.push(`Step Irons × ${order.addOns.stepIrons.quantity}`);
  }

  if (order.addOns.meshAndOrificePlates.required !== "No") {
    materials.push(`Mesh & Orifice Plates (${order.addOns.meshAndOrificePlates.required})`);
  }

  if (order.addOns.pipeToStreet.required) {
    materials.push(`Pipe to Street (${order.addOns.pipeToStreet.length})`);
  }

  for (const pit of order.addOns.kerbInletPits) {
    materials.push(`Kerb Inlet Pit ${pit.pitNumber} (Depth: ${pit.installationDepth})`);
  }

  if (order.addOns.headWall) {
    materials.push("Head Wall");
  }

  return materials;
}
