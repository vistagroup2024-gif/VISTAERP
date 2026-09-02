/**
 * Vista AI permission matrix check.
 *
 *   npx tsx scripts/check-ai-permissions.ts
 *
 * The claim this file exists to test is the load-bearing one: Vista AI can
 * never reach something the person talking to her could not reach themselves.
 * That claim rests on the tool registry, so this runs the real registry —
 * not a mock of it — against a set of realistic staff profiles and asserts
 * what each one is and is not offered.
 *
 * It needs no database, no API key and no running app, so it can be run on
 * every change. Exits non-zero if any expectation fails.
 */

import { allTools, toolsFor, canUse, findTool } from "../lib/ai/registry";
import { STAFF_PERMISSION_CATALOG, ALL_STAFF_PERM_KEYS } from "../lib/staffPermissions";
import type { StaffAccess } from "../lib/staffAccess";

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
}

function user(permissions: string[], opts?: { admin?: boolean; unrestricted?: boolean }): StaffAccess {
  const map: Record<string, boolean> = {};
  for (const p of permissions) map[p] = true;
  return {
    isAdmin: !!opts?.admin,
    permissions: map,
    fullName: "Test",
    unrestricted: opts?.unrestricted ?? !!opts?.admin,
  };
}

const names = (a: StaffAccess) => toolsFor(a).map((t) => t.name).sort();

console.log("\nVista AI — permission matrix\n");

// ---------------------------------------------------------------------------
console.log("Registry integrity");
// ---------------------------------------------------------------------------
const tools = allTools();
check("every registered tool declares a permission", tools.every((t) => !!t.perm),
  tools.filter((t) => !t.perm).map((t) => t.name).join(", "));

const unknown = tools.filter((t) => !ALL_STAFF_PERM_KEYS.includes(t.perm));
check("every tool permission exists in the staff catalog", unknown.length === 0,
  unknown.map((t) => `${t.name} → ${t.perm}`).join(", "));

const dupes = tools.map((t) => t.name).filter((n, i, a) => a.indexOf(n) !== i);
check("no duplicate tool names", dupes.length === 0, dupes.join(", "));

check("every tool has a description the model can act on",
  tools.every((t) => t.description.length > 40));

// ---------------------------------------------------------------------------
console.log("\nNo tool executes — she prepares, the user disposes");
// ---------------------------------------------------------------------------
// Write tools may STAGE work. None may carry it out: execution lives behind
// /api/ai/action and /api/ai/dev, which the model cannot reach.
const writeTools = tools.filter((t) => t.kind === "write").map((t) => t.name);
check("write tools are only the preparing ones",
  writeTools.every((n) => n.startsWith("prepare_")),
  `unexpected: ${writeTools.filter((n) => !n.startsWith("prepare_")).join(", ")}`);
check("there is no send/post/delete/deploy tool",
  !tools.some((t) => /^(send|post|delete|cancel|deploy|merge|approve)_/.test(t.name)),
  tools.map((t) => t.name).filter((n) => /^(send|post|delete|cancel|deploy|merge|approve)_/.test(n)).join(", "));

// ---------------------------------------------------------------------------
console.log("\nA user with no Vista AI access gets nothing");
// ---------------------------------------------------------------------------
const noAi = user(["accounting.view", "transport.bookings", "ai.actions"]);
check("no ai.use → no tools at all", names(noAi).length === 0);

// ---------------------------------------------------------------------------
console.log("\nRead access follows the module the user actually has");
// ---------------------------------------------------------------------------
const transportOnly = user(["ai.use", "transport.bookings"]);
const tOnly = names(transportOnly);
check("transport-only user gets get_transport_bookings", tOnly.includes("get_transport_bookings"));
check("transport-only user cannot reach the ledger", !tOnly.includes("get_party_ledger"));
check("transport-only user cannot reach outstanding", !tOnly.includes("get_outstanding"));
check("transport-only user cannot reach hotels", !tOnly.includes("get_hotel_bookings"));
check("transport-only user cannot reach visa groups", !tOnly.includes("get_visa_groups"));

const acctOnly = user(["ai.use", "accounting.view"]);
const aOnly = names(acctOnly);
check("accounting-only user gets the ledger", aOnly.includes("get_party_ledger"));
check("accounting-only user cannot reach transport", !aOnly.includes("get_transport_bookings"));

// ---------------------------------------------------------------------------
console.log("\nActions need ai.actions AND the module permission — both, or neither");
// ---------------------------------------------------------------------------
const acctNoActions = user(["ai.use", "accounting.view"]);
check("accounting without ai.actions cannot prepare reminders",
  !names(acctNoActions).includes("prepare_payment_reminders"));

const actionsNoAcct = user(["ai.use", "ai.actions", "transport.bookings"]);
check("ai.actions without accounting cannot prepare reminders",
  !names(actionsNoAcct).includes("prepare_payment_reminders"));

const both = user(["ai.use", "ai.actions", "accounting.view"]);
check("ai.actions + accounting CAN prepare reminders",
  names(both).includes("prepare_payment_reminders"));

// ---------------------------------------------------------------------------
console.log("\nDevelopment is its own permission");
// ---------------------------------------------------------------------------
const noDev = user(["ai.use", "ai.actions", "accounting.view"]);
check("without ai.dev there is no development tool",
  !names(noDev).includes("prepare_development_task"));

const devNoActions = user(["ai.use", "ai.dev"]);
check("ai.dev without ai.actions cannot draft a task (write tools need both)",
  !names(devNoActions).includes("prepare_development_task"));

const dev = user(["ai.use", "ai.actions", "ai.dev"]);
check("ai.dev + ai.actions CAN draft a development task",
  names(dev).includes("prepare_development_task"));

// ---------------------------------------------------------------------------
console.log("\ncanUse() agrees with the listing, tool by tool");
// ---------------------------------------------------------------------------
// The registry checks permission twice — once when listing tools for the model,
// once when a call actually runs. If those two ever disagree, a model could be
// offered something that then refuses, or worse, the reverse.
const profiles: [string, StaffAccess][] = [
  ["admin", user([], { admin: true, unrestricted: true })],
  ["no-ai", noAi],
  ["transport-only", transportOnly],
  ["accounting-only", acctOnly],
  ["accounting+actions", both],
  ["developer", dev],
];

let mismatch = 0;
for (const [, access] of profiles) {
  const listed = new Set(toolsFor(access).map((t) => t.name));
  for (const t of allTools()) {
    if (listed.has(t.name) !== canUse(access, t)) mismatch++;
  }
}
check("listing and execution checks never disagree", mismatch === 0, `${mismatch} disagreement(s)`);

// ---------------------------------------------------------------------------
console.log("\nAn unknown tool name is refused");
// ---------------------------------------------------------------------------
check("findTool returns nothing for an invented name", findTool("send_all_the_money") === undefined);

// ---------------------------------------------------------------------------
console.log("\nAn admin sees everything (and that is a real list)");
// ---------------------------------------------------------------------------
const admin = user([], { admin: true, unrestricted: true });
check("admin gets every registered tool", names(admin).length === allTools().length);
check("there is a meaningful number of tools", allTools().length >= 15,
  `${allTools().length} registered`);

// ---------------------------------------------------------------------------
console.log("\nThe AI permission keys are in the catalog admins actually edit");
// ---------------------------------------------------------------------------
const aiGroup = STAFF_PERMISSION_CATALOG.find((g) => g.module === "Vista AI");
check("Vista AI appears in the staff permission catalog", !!aiGroup);
for (const key of ["ai.use", "ai.actions", "ai.dev"]) {
  check(`${key} is grantable in the UI`, !!aiGroup?.perms.some((p) => p.key === key));
}

// ---------------------------------------------------------------------------
console.log(
  failures === 0
    ? `\nAll checks passed. ${allTools().length} tools registered.\n`
    : `\n${failures} check(s) FAILED.\n`
);
process.exit(failures === 0 ? 0 : 1);
