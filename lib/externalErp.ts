// ============================================================
// External ERP export — configurable Field Mapping Engine.
//
// Vista Group's own screens never change. Each destination ERP is described
// by a template that maps our data into the destination's field order and
// serialises it for clipboard paste. Add a new partner ERP by adding a new
// entry to TEMPLATES — no core changes required.
// ============================================================

export interface ExtGroup {
  groupNo: string;
  pax: number | string;
  arrivalDate: string;
  arrivalFlight: string;
  arrivalFrom: string;   // origin city/airport
  arrivalTo: string;     // Saudi arrival airport
  departureDate: string;
  departureFlight: string;
  departureFrom: string; // Saudi departure airport
  departureTo: string;   // international destination city
}

export interface ExtHotel {
  agreement: string;
  city: string;
  hotel: string;
  checkIn: string;
  checkOut: string;
  nights: number;
}

export interface ExtTemplate {
  id: string;
  name: string;
  description: string;
  build: (g: ExtGroup, hotels: ExtHotel[]) => string;
}

const TAB = "\t";

// ---- Template: External ERP A (tab/newline grid paste) ----
// Group fields on the first line in the destination's exact order, then one
// tab-separated line per allocated hotel. Pasting into the first field fills
// sequential fields (Tab) and rows (Enter), matching a spreadsheet-style grid.
const templateA: ExtTemplate = {
  id: "erp_a",
  name: "External ERP A",
  description: "Tab-separated: group row + one row per hotel. Paste into the first field.",
  build: (g, hotels) => {
    const groupLine = [
      g.groupNo, g.pax, g.arrivalDate, g.arrivalFlight, g.arrivalFrom, g.arrivalTo,
      g.departureDate, g.departureFlight, g.departureFrom, g.departureTo,
    ].join(TAB);
    const hotelLines = hotels.map((h) =>
      [h.agreement, h.city, h.hotel, h.checkIn, h.checkOut, h.nights].join(TAB)
    );
    return [groupLine, ...hotelLines].join("\n");
  },
};

// ---- Template: External ERP B (labelled key: value block) ----
// Example of a different destination layout to prove the mapping is not
// hardcoded. Human-readable labelled fields + a hotel table.
const templateB: ExtTemplate = {
  id: "erp_b",
  name: "External ERP B (labelled)",
  description: "Labelled fields (Field: Value) followed by a hotel list.",
  build: (g, hotels) => {
    const lines = [
      `Group No: ${g.groupNo}`,
      `Total Pax: ${g.pax}`,
      `Arrival Date in KSA: ${g.arrivalDate}`,
      `Arrival Flight No: ${g.arrivalFlight}`,
      `From: ${g.arrivalFrom}`,
      `To: ${g.arrivalTo}`,
      `Departure Date from KSA: ${g.departureDate}`,
      `Departure Flight No: ${g.departureFlight}`,
      `From: ${g.departureFrom}`,
      `To: ${g.departureTo}`,
      "",
      "Hotel Details:",
      "Agreement No\tCity\tHotel\tCheck-in\tCheck-out\tNights",
      ...hotels.map((h) => [h.agreement, h.city, h.hotel, h.checkIn, h.checkOut, h.nights].join(TAB)),
    ];
    return lines.join("\n");
  },
};

export const TEMPLATES: ExtTemplate[] = [templateA, templateB];

export function buildExport(templateId: string, g: ExtGroup, hotels: ExtHotel[]): string {
  const t = TEMPLATES.find((x) => x.id === templateId) ?? TEMPLATES[0];
  return t.build(g, hotels);
}
