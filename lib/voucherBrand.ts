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

// Standard terms & conditions printed on both the hotel voucher and the
// invoice — same wording on each. Edit the text here to match the official
// wording.
export const VISTA_HOTEL_TERMS = [
  "Payment must be settled by the stated option date. Failure to pay will result in cancellation and a one-night charge.",
  "Check-in: 4:00 PM | Check-out: 12:00 PM.",
  "Late check-out or additional nights will be charged accordingly.",
  "No-show: Full amount will be charged.",
  "Cancellation: 7+ days before arrival — one-night charge; within 5 days — full amount.",
  "During high season, holidays, Ramadan, Hajj, and high Umrah season, cancellations/no-shows are subject to full charges.",
  "Any booking amendments are subject to hotel availability.",
];
