// Dynamic WhatsApp message builders. Each module passes real record data; nothing is
// hard-coded to a single message. Keep messages short and friendly.

const money = (n: number | null | undefined, ccy = "SAR") =>
  n == null ? "" : `${ccy} ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n))}`;

export const waMsg = {
  // Generic greeting.
  hello: (name?: string | null) => `Dear ${name || "Sir/Madam"},`,

  // Booking confirmation (transport / hotel / visa).
  bookingConfirmed: (o: { name?: string | null; bookingNo?: string | null; service?: string | null; date?: string | null }) =>
    `Dear ${o.name || "Guest"}, your booking ${o.bookingNo ? `#${o.bookingNo}` : ""}${o.service ? ` for ${o.service}` : ""}${o.date ? ` on ${o.date}` : ""} has been confirmed. Thank you for choosing Vista Group.`,

  // Payment reminder with outstanding amount.
  paymentReminder: (o: { name?: string | null; reference?: string | null; amount?: number | null; currency?: string | null }) =>
    `Dear ${o.name || "Customer"}, this is a friendly reminder that an amount of ${money(o.amount, o.currency || "SAR")} is outstanding on your account${o.reference ? ` (ref ${o.reference})` : ""}. Kindly arrange the payment at your earliest convenience. Thank you.`,

  // Agent booking update.
  agentBooking: (o: { agent?: string | null; bookingNo?: string | null; status?: string | null }) =>
    `Dear ${o.agent || "Partner"}, your booking ${o.bookingNo ? `#${o.bookingNo}` : ""} status is now ${o.status || "updated"}. Please check your Vista B2B portal for details.`,

  // Transport driver / trip details for the passenger.
  tripDetails: (o: { name?: string | null; date?: string | null; time?: string | null; route?: string | null; vehicle?: string | null; driver?: string | null; driverPhone?: string | null }) =>
    [`Dear ${o.name || "Guest"}, your transport is confirmed.`,
     o.date && `Date: ${o.date}${o.time ? ` ${o.time}` : ""}`,
     o.route && `Route: ${o.route}`,
     o.vehicle && `Vehicle: ${o.vehicle}`,
     o.driver && `Driver: ${o.driver}${o.driverPhone ? ` (${o.driverPhone})` : ""}`,
     "Safe travels — Vista Group."].filter(Boolean).join("\n"),
};
