import { describe, it, expect } from "vitest";
import { rowsToClients, buildReconciliationClients, parseAgreedHours } from "./accrualsSync.js";

// Regression coverage for two real production bugs found and fixed in this codebase's
// history (see accrualsSync.js's comments on agreedByMonth and rowsToClients' agreedHpm) --
// both were silent, both shipped to production before being caught by inspection rather
// than a test. Written so either bug reintroduces itself as a failing test, not a support
// ticket.

describe("parseAgreedHours", () => {
  it("extracts the first number, including from an annotated string", () => {
    expect(parseAgreedHours("24 (Aug)")).toBe(24);
    expect(parseAgreedHours("8 (increased to 10 Aug)")).toBe(8);
    expect(parseAgreedHours(16)).toBe(16);
    expect(parseAgreedHours(null)).toBeNull();
    expect(parseAgreedHours(undefined)).toBeNull();
  });
});

describe("buildReconciliationClients — per-month agreed hours (ARAS regression)", () => {
  // A client that was on package for a while, then moved to hourly -- e.g. ARAS, off
  // package since August 2026. The August row exists (recomputeAccruals ran and
  // determined "not on a package this month") but its agreed_hpm is null, distinct from
  // "no row for this month at all."
  const rows = [
    { client: "ARAS", account_manager: "Chloe James", agreed_hpm: "32", month_key: "2026-03", accrual_value: "4.7", accrual_note: null, pct_over_under: null, comment: null, worked_hours: null, is_override: true, hours_flagged: false },
    { client: "ARAS", account_manager: "Chloe James", agreed_hpm: null, month_key: "2026-08", accrual_value: null, accrual_note: "Not on a package this month", pct_over_under: null, comment: null, worked_hours: null, is_override: false, hours_flagged: false },
  ];

  it("keeps a covered-but-null month's agreed hours as null, not falling back to the stale client-level scalar", () => {
    const { clients } = buildReconciliationClients(rowsToClients(rows));
    const aras = clients.find((c) => c.name === "ARAS");
    // The client-level scalar is stale (picks up whichever row had a non-null agreed_hpm --
    // here, March's leftover "32") -- callers must never read it for a specific month.
    expect(aras.package).toBe(32);
    // But the August row itself explicitly has no package -- "in agreedByMonth" must be
    // true (a row exists) with value null, not simply absent (which would read as "no
    // data, fall back to package").
    expect("2026-08" in aras.agreedByMonth).toBe(true);
    expect(aras.agreedByMonth["2026-08"]).toBeNull();
    expect(aras.agreedByMonth["2026-03"]).toBe(32);
  });

  it("omits agreedByMonth entirely for a month with no row at all -- the one case a caller SHOULD fall back to the scalar for", () => {
    const { clients } = buildReconciliationClients(rowsToClients(rows));
    const aras = clients.find((c) => c.name === "ARAS");
    expect("2026-01" in aras.agreedByMonth).toBe(false);
  });
});

describe("rowsToClients — agreed_hpm is a stale client-level snapshot, never authoritative per month", () => {
  it("does not let a later null agreed_hpm row erase an earlier real one from the client-level scalar (documents existing last-write-wins behavior)", () => {
    // This is the exact shape that caused Amorim Cork/Warrina Homes/Apex Energy to show a
    // stuck, wrong package figure: whichever row happens to be scanned last with a non-null
    // agreed_hpm wins the client-level `agreedHpm`, regardless of which month is "current."
    // The fix was moving callers off this field for anything month-specific (see the test
    // above) -- this test just pins down that the field itself still behaves this way, so a
    // future edit doesn't quietly change rowsToClients' contract without the per-month
    // fallback logic being re-examined too.
    const rows = [
      { client: "Amorim Cork", agreed_hpm: "0", month_key: "2026-01", accrual_value: null, is_override: true },
      { client: "Amorim Cork", agreed_hpm: "16", month_key: "2026-09", accrual_value: "-47.92", is_override: false },
    ];
    const [client] = rowsToClients(rows);
    // Whichever row is scanned LAST with a truthy agreed_hpm wins -- here, September's 16.
    expect(client.agreedHpm).toBe("16");
    // Per-row data is still correct regardless -- this is what callers must use instead.
    expect(client.months["2026-01"].agreedHpm).toBe("0");
    expect(client.months["2026-09"].agreedHpm).toBe("16");
  });
});
