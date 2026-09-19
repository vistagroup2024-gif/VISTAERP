// Vista company details shown on the Vista-branded transport voucher (both the
// internal staff voucher and the public shareable one). Edit these to match
// your official details.
export const VISTA = {
  name: "Vista Group",
  tagline: "Umrah | Transportation | Tourism",
  contact: "Vista Operations",
  mobile: "+966 53 004 8282",
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

// Standard terms & conditions printed on the hotel invoice (amount-bearing
// document only). Edit to match the official wording.
export const VISTA_HOTEL_TERMS = [
  "All reservations are quoted in Saudi Arabian Riyals (SAR).",
  "Payment must be settled by the option date provided. Failure to settle payment by the given date will result in the cancellation of the booking, and a one-night charge will be applied to your account.",
  "Check-in time is at 4:00 PM.",
  "Check-out time is at 12:00 PM.",
  "It is the client's responsibility to ensure a smooth check-out process. Any additional charges for extra nights incurred due to late check-out will be billed to the client's account accordingly.",
  "In case of a no-show, the full amount will be charged.",
  "For cancellations made prior to 7 days before the guest's arrival, a one-night charge will be applied.",
  "For cancellations made within 5 days of the guest's arrival, the full amount will be charged.",
  "During high season periods (e.g., Ramadan, Hajj, high Umrah season, school holidays, and public holidays), full payment will be charged for cancellations or no-shows.",
  "Any amendments to the booking will be subject to hotel availability.",
  "Amendments cannot be used as a reason for cancellation or to request a refund of any amount paid.",
];
