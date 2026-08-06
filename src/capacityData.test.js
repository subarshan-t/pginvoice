import { describe, it, expect } from "vitest";
import { agreedAt, computeMonthlyAvailability, resignationStatus } from "./capacityData.js";
import { adelaideLocalMidnightUtcMs } from "./dateMath.js";

describe("agreedAt", () => {
  it("returns the base agreed hours when there is no history", () => {
    expect(agreedAt({ agreed: 20, history: [] }, "2026-05")).toBe(20);
  });

  it("returns 0 once a month reaches the offboarded date", () => {
    const client = { agreed: 20, history: [], offboardedFrom: "2026-06" };
    expect(agreedAt(client, "2026-05")).toBe(20);
    expect(agreedAt(client, "2026-06")).toBe(0);
    expect(agreedAt(client, "2026-07")).toBe(0);
  });

  it("uses the latest history entry whose `from` is <= the requested month", () => {
    const client = {
      agreed: 38,
      history: [
        { from: "2026-03", agreed: 32 },
        { from: "2026-06", agreed: 40 },
      ],
    };
    expect(agreedAt(client, "2026-01")).toBe(38);
    expect(agreedAt(client, "2026-03")).toBe(32);
    expect(agreedAt(client, "2026-05")).toBe(32);
    expect(agreedAt(client, "2026-06")).toBe(40);
    expect(agreedAt(client, "2026-12")).toBe(40);
  });

  it("skips malformed history entries instead of throwing", () => {
    const client = { agreed: 20, history: [null, { from: "2026-04", agreed: 25 }, {}] };
    expect(() => agreedAt(client, "2026-05")).not.toThrow();
    expect(agreedAt(client, "2026-05")).toBe(25);
  });
});

describe("resignationStatus", () => {
  it("is active with no resignation date", () => {
    expect(resignationStatus({ resignationDate: null }, "2026-05")).toEqual({ active: true, throughDay: null });
  });

  it("is fully active for months before the resignation month", () => {
    expect(resignationStatus({ resignationDate: "2026-06-15" }, "2026-05")).toEqual({ active: true, throughDay: null });
  });

  it("is inactive for months after the resignation month", () => {
    expect(resignationStatus({ resignationDate: "2026-06-15" }, "2026-07")).toEqual({ active: false, throughDay: null });
  });

  it("caps to the resignation day within the resignation month", () => {
    expect(resignationStatus({ resignationDate: "2026-06-15" }, "2026-06")).toEqual({ active: true, throughDay: 15 });
  });
});

describe("computeMonthlyAvailability", () => {
  const person = { contracted: 38, rate: 0.7, state: "SA" };

  it("returns null once a person has resigned in an earlier month", () => {
    const resigned = { ...person, resignationDate: "2026-04-30" };
    expect(computeMonthlyAvailability(resigned, "2026-05", 0)).toBeNull();
  });

  it("subtracts leave hours from total monthly hours", () => {
    const withLeave = computeMonthlyAvailability(person, "2026-05", 10);
    const withoutLeave = computeMonthlyAvailability(person, "2026-05", 0);
    expect(withLeave.totalMonthlyHours).toBeCloseTo(withoutLeave.totalMonthlyHours - 10, 5);
  });

  it("splits total hours into billable/non-billable using the person's rate", () => {
    const result = computeMonthlyAvailability(person, "2026-05", 0);
    expect(result.billableHours).toBeCloseTo(result.totalMonthlyHours * person.rate, 5);
    expect(result.billableHours + result.nonBillableHours).toBeCloseTo(result.totalMonthlyHours, 5);
  });
});

describe("adelaideLocalMidnightUtcMs", () => {
  it("resolves standard-time (UTC+9:30) local midnight to the correct UTC instant", () => {
    // 1 July 2026 00:00 Adelaide (ACST, UTC+9:30) is 30 June 16:30 UTC.
    const ms = adelaideLocalMidnightUtcMs(2026, 7, 1);
    expect(new Date(ms).toISOString()).toBe("2026-06-30T14:30:00.000Z");
  });

  it("resolves daylight-saving (UTC+10:30) local midnight to the correct UTC instant", () => {
    // 1 January 2026 00:00 Adelaide (ACDT, UTC+10:30) is 31 Dec 13:30 UTC.
    const ms = adelaideLocalMidnightUtcMs(2026, 1, 1);
    expect(new Date(ms).toISOString()).toBe("2025-12-31T13:30:00.000Z");
  });

  it("gives consecutive months a positive, correctly-ordered gap", () => {
    const start = adelaideLocalMidnightUtcMs(2026, 7, 1);
    const end = adelaideLocalMidnightUtcMs(2026, 8, 1);
    expect(end).toBeGreaterThan(start);
  });
});
