// Vista company details shown on the Vista-branded transport voucher (both the
// internal staff voucher and the public shareable one). Edit these to match
// your official details.
export const VISTA = {
  name: "Vista Group",
  tagline: "Umrah | Transportation | Tourism",
  contact: "Vista Operations",
  mobile: "+966 53 004 7373",
  email: "sales@vista-group.co",
  address: "Khalidiya, Madinah",
  // The pin mark only; the header stacks the name + tagline beneath it to form
  // the Vista Group lockup (logoLockup = true).
  logo: "/logo.svg",
  logoLockup: true,
};

// Bank account shown on the hotel invoice (amount-bearing document only —
// never on the amount-free voucher). Edit to match the official account.
export const VISTA_BANK = {
  bankName: "Al Rajhi Bank",
  accountName: "Vista Group Company",
  accountNumber: "552000010006081111152",
  iban: "SA8080000552608011111152",
};

// Standard terms & conditions printed on both the hotel voucher and invoice.
// `amount: true` marks a clause that names a price, charge or payment — it
// prints on the invoice only; the voucher (no pricing anywhere on it) gets
// everything else. Edit the text here to match the official wording; the
// voucher/invoice lists below stay in sync automatically.
const HOTEL_TERMS: { text: string; amount?: boolean }[] = [
  { text: "All reservations are quoted in Saudi Arabian Riyals (SAR).", amount: true },
  { text: "Payment must be settled by the option date provided. Failure to settle payment by the given date will result in the cancellation of the booking, and a one-night charge will be applied to your account.", amount: true },
  { text: "Check-in time is at 4:00 PM." },
  { text: "Check-out time is at 12:00 PM." },
  { text: "It is the client's responsibility to ensure a smooth check-out process. Any additional charges for extra nights incurred due to late check-out will be billed to the client's account accordingly." },
  { text: "In case of a no-show, the full amount will be charged." },
  { text: "For cancellations made prior to 7 days before the guest's arrival, a one-night charge will be applied." },
  { text: "For cancellations made within 5 days of the guest's arrival, the full amount will be charged." },
  { text: "During high season periods (e.g., Ramadan, Hajj, high Umrah season, school holidays, and public holidays), full payment will be charged for cancellations or no-shows." },
  { text: "Any amendments to the booking will be subject to hotel availability." },
  { text: "Amendments cannot be used as a reason for cancellation or to request a refund of any amount paid." },
];

export const VISTA_HOTEL_TERMS = HOTEL_TERMS.map((t) => t.text);
export const VISTA_HOTEL_TERMS_VOUCHER = HOTEL_TERMS.filter((t) => !t.amount).map((t) => t.text);
