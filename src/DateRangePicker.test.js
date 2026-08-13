import { describe, it, expect } from "vitest";
import { parseCivilDate, civilDateStr } from "./DateRangePicker.jsx";

describe("parseCivilDate / civilDateStr (civil-date round-trip, no UTC-parsing bug)", () => {
  it("round-trips a plain date without shifting a day", () => {
    expect(civilDateStr(parseCivilDate("2026-03-05"))).toBe("2026-03-05");
  });

  it("round-trips the first and last day of a month", () => {
    expect(civilDateStr(parseCivilDate("2026-01-01"))).toBe("2026-01-01");
    expect(civilDateStr(parseCivilDate("2026-12-31"))).toBe("2026-12-31");
  });

  it("round-trips across a DST transition date (Adelaide, early April)", () => {
    // The classic failure mode this whole helper pair exists to avoid: new
    // Date("2026-04-05") parses as UTC midnight, which in any timezone AHEAD of
    // UTC (Adelaide is UTC+9:30/+10:30) prints as April 4th once read back with
    // local getters -- exactly the off-by-one-day bug the civil-date approach
    // (local Date constructor in, local getters out) is built to never hit.
    expect(civilDateStr(parseCivilDate("2026-04-05"))).toBe("2026-04-05");
  });

  it("parseCivilDate constructs a LOCAL date, not a UTC-parsed one", () => {
    const d = parseCivilDate("2026-06-15");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5); // 0-indexed
    expect(d.getDate()).toBe(15);
  });

  it("returns undefined/null for empty input instead of an Invalid Date", () => {
    expect(parseCivilDate(null)).toBeUndefined();
    expect(parseCivilDate("")).toBeUndefined();
    expect(civilDateStr(null)).toBeNull();
    expect(civilDateStr(undefined)).toBeNull();
  });

  it("pads single-digit month/day back into the civil-date string format", () => {
    expect(civilDateStr(new Date(2026, 0, 5))).toBe("2026-01-05"); // Jan 5
  });
});
