import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  ChevronDown, ChevronRight, ChevronLeft, Check, X, Plus, Pencil, Search, Download, AlertTriangle,
} from "lucide-react";

/* ============================================================
   MONTHS / CONSTANTS
============================================================ */
const MONTHS = ["2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"];
const CURRENT_MONTH = "2026-07";
const MONTH_LABELS = { "2025-12": "Dec 25", "2026-01": "Jan 26", "2026-02": "Feb 26", "2026-03": "Mar 26", "2026-04": "Apr 26", "2026-05": "May 26", "2026-06": "Jun 26", "2026-07": "Jul 26", "2026-08": "Aug 26", "2026-09": "Sep 26", "2026-10": "Oct 26", "2026-11": "Nov 26", "2026-12": "Dec 26" };

// Real, named public holidays for SA/WA/QLD, weekdays only (weekend-falling holidays
// with no substitute don't affect working-day capacity, so they're excluded here — e.g.
// ANZAC Day 2026 falls on a Saturday and SA/QLD give no substitute day).
// Sourced from each state's official 2026 public holiday calendar (Dec 2025 included for
// months prior to Jan 2026). Verify before relying on this for payroll purposes.
const PUBLIC_HOLIDAYS = {
  SA: [
    { date: "2025-12-25", name: "Christmas Day" },
    { date: "2025-12-26", name: "Proclamation Day" },
    { date: "2026-01-01", name: "New Year's Day" },
    { date: "2026-01-26", name: "Australia Day" },
    { date: "2026-03-09", name: "Adelaide Cup Day" },
    { date: "2026-04-03", name: "Good Friday" },
    { date: "2026-04-06", name: "Easter Monday" },
    { date: "2026-06-08", name: "King's Birthday" },
    { date: "2026-10-05", name: "Labour Day" },
    { date: "2026-12-25", name: "Christmas Day" },
    { date: "2026-12-28", name: "Proclamation Day (in lieu)" },
  ],
  WA: [
    { date: "2025-12-25", name: "Christmas Day" },
    { date: "2025-12-26", name: "Boxing Day" },
    { date: "2026-01-01", name: "New Year's Day" },
    { date: "2026-01-26", name: "Australia Day" },
    { date: "2026-03-02", name: "Labour Day" },
    { date: "2026-04-03", name: "Good Friday" },
    { date: "2026-04-06", name: "Easter Monday" },
    { date: "2026-04-27", name: "ANZAC Day (in lieu)" },
    { date: "2026-06-01", name: "Western Australia Day" },
    { date: "2026-09-28", name: "King's Birthday" },
    { date: "2026-12-25", name: "Christmas Day" },
    { date: "2026-12-28", name: "Boxing Day (in lieu)" },
  ],
  QLD: [
    { date: "2025-12-25", name: "Christmas Day" },
    { date: "2025-12-26", name: "Boxing Day" },
    { date: "2026-01-01", name: "New Year's Day" },
    { date: "2026-01-26", name: "Australia Day" },
    { date: "2026-04-03", name: "Good Friday" },
    { date: "2026-04-06", name: "Easter Monday" },
    { date: "2026-05-04", name: "Labour Day" },
    { date: "2026-08-12", name: "Royal Queensland Show (Ekka, Brisbane)" },
    { date: "2026-10-05", name: "King's Birthday" },
    { date: "2026-12-25", name: "Christmas Day" },
    { date: "2026-12-28", name: "Boxing Day (in lieu)" },
  ],
};

// Exact count of Mon-Fri weekdays in a given "YYYY-MM" month — computed directly
// from the calendar rather than a flat assumption, so short/long months are accurate.
function weekdaysInMonth(monthStr) {
  const [y, mo] = monthStr.split("-").map(Number);
  const daysInMonth = new Date(y, mo, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(y, mo - 1, d).getDay();
    if (dow >= 1 && dow <= 5) count++;
  }
  return count;
}
function publicHolidayDays(state, monthStr) {
  const list = PUBLIC_HOLIDAYS[state] || PUBLIC_HOLIDAYS.SA;
  return list.filter((h) => h.date.startsWith(monthStr)).length;
}
// Groups this month's holidays by date, and by date lists which states observe what —
// this is what powers the plain-English "X is a holiday in..." summary.
function holidaysInMonthGrouped(monthStr) {
  const byDate = {};
  ["SA", "WA", "QLD"].forEach((state) => {
    PUBLIC_HOLIDAYS[state].filter((h) => h.date.startsWith(monthStr)).forEach((h) => {
      if (!byDate[h.date]) byDate[h.date] = {};
      byDate[h.date][state] = h.name;
    });
  });
  return Object.keys(byDate).sort().map((date) => {
    const day = Number(date.split("-")[2]);
    const ordinal = (n) => { const s = ["th", "st", "nd", "rd"]; const v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
    return { date, dayLabel: ordinal(day), states: byDate[date] };
  });
}

const uid = (p) => p + Math.random().toString(36).slice(2, 9);
const FIXED_BASES = ["Package", "Project", "Quoted", "MAP", "Strategy"];
const VARIABLE_BASES = ["Hourly", "Ad hoc"];

/* ============================================================
   SEED DATA (unchanged from the real Resourcing sheet + ClickUp actuals)
============================================================ */
const SEED_PEOPLE = [
  { id: "p1", name: "Holly", role: "Consultant", state: "SA", contracted: 38, rate: 0.70, note: "Standard" },
  { id: "p2", name: "Shreya", role: "Consultant", state: "SA", contracted: 38, rate: 0.60, note: "Probation" },
  { id: "p3", name: "Chloe", role: "Consultant", state: "SA", contracted: 30, rate: 0.70, note: "Standard" },
  { id: "p4", name: "Alice", role: "Consultant", state: "SA", contracted: 22.5, rate: 0.70, note: "Standard" },
  { id: "p5", name: "Amanda", role: "Consultant", state: "WA", contracted: 38, rate: 0.20, note: "Support-heavy role — worth reviewing" },
  { id: "p6", name: "Lucy", role: "Consultant", state: "QLD", contracted: 38, rate: 0.50, note: "Probation + BDM discount" },
  { id: "p7", name: "Vinavie", role: "Consultant", state: "SA", contracted: 38, rate: 0.70, note: "Standard" },
  { id: "p8", name: "Alex", role: "Coordinator", state: "SA", contracted: 38, rate: 0.70, note: "Supports others + Purple Giraffe internal work" },
  { id: "p9", name: "Ariani", role: "Coordinator", state: "SA", contracted: 38, rate: 0.70, note: "Standard" },
  { id: "p10", name: "Chelsea", role: "Coordinator", state: "SA", contracted: 38, rate: 0.60, note: "Probation" },
  { id: "p11", name: "Vino", role: "Coordinator", state: "SA", contracted: 38, rate: 0.60, note: "Probation" },
  { id: "p12", name: "Julia", role: "Coordinator", state: "QLD", contracted: 38, rate: 0.60, note: "Probation" },
  { id: "p13", name: "Tanya", role: "Coordinator", state: "SA", contracted: 15, rate: 0.70, note: "Part-time, currently unallocated" },
];

function C(id, client, group, lead, basis, agreed, actuals, note) {
  return { id, client, group, lead, basis, agreed, actuals: actuals || null, note: note || "" };
}
const SEED_CLIENTS = [
  C("c1", "Amorim Cork", "Amorim Cork", "Chloe", "Package", 16, { "2026-01": 4.5, "2026-02": 5.3, "2026-03": 5.0, "2026-04": 9.5, "2026-05": 0.5, "2026-06": 0.8 }),
  C("c2", "Apex Energy", "Apex Energy", "Chloe", "Package", 16, { "2026-01": 11.7, "2026-02": 7.8, "2026-03": 22.8, "2026-04": 15.8, "2026-05": 18.3, "2026-06": 36.7 }),
  C("c3", "Apex Communications", "Apex Communications", "Chloe", "Package", 30.5, { "2026-01": 0, "2026-02": 0, "2026-03": 0, "2026-04": 0, "2026-05": 28.6, "2026-06": 19.5 }),
  C("c4", "ARAS", "ARAS", "Chloe", "Hourly", null, { "2026-01": 0, "2026-02": 0, "2026-03": 3.1, "2026-04": 5.6, "2026-05": 3.7, "2026-06": 2.7 }),
  C("c5", "Equippers", "Equippers", "Chloe", "Quoted", null, { "2026-01": 0, "2026-02": 11.2, "2026-03": 5.0, "2026-04": 3.3, "2026-05": 10.0, "2026-06": 0.4 }),
  C("c6", "Spectrum Consultants", "Spectrum Consultants", "Chloe", "Package", 24, { "2026-01": 21.8, "2026-02": 36.9, "2026-03": 35.9, "2026-04": 22.7, "2026-05": 22.8, "2026-06": 21.1 }),
  C("c7", "Treasure Boxes", "Treasure Boxes", "Chloe", "Package", 10, { "2026-01": 21.8, "2026-02": 20.2, "2026-03": 3.4, "2026-04": 0, "2026-05": 0, "2026-06": 11.5 }),
  C("c8", "Warrina Homes — Package", "Warrina Homes", "Chloe", "Package", 24, { "2026-01": 28.5, "2026-02": 27.8, "2026-03": 7.2, "2026-04": 46.8, "2026-05": 50.0, "2026-06": 44.1 }),
  C("c9", "Warrina Homes — Employee Handbook", "Warrina Homes", "Chloe", "Project", null, null),

  C("c10", "Australian GW", "Australian GW", "Vinavie", "Hourly", 0, null),
  C("c11", "Clare Valley Wine & Grape", "Clare Valley Wine & Grape", "Vinavie", "Package", 8, { "2026-01": 17.9, "2026-02": 5.2, "2026-03": 9.0, "2026-04": 7.8, "2026-05": 2.3, "2026-06": 0.8 }),
  C("c12", "Coonawarra", "Coonawarra", "Vinavie", "Package", 16, { "2026-01": 0, "2026-02": 0, "2026-03": 25.5, "2026-04": 17.7, "2026-05": 21.8, "2026-06": 13.6 }),
  C("c13", "Riverland Wine — Package", "Riverland Wine", "Vinavie", "Package", 8, { "2026-01": 9.8, "2026-02": 14.8, "2026-03": 14.2, "2026-04": 11.9, "2026-05": 23.1, "2026-06": 3.2 }),
  C("c14", "Riverland Wine — Melbourne Showcase", "Riverland Wine", "Vinavie", "Quoted", 25, null),
  C("c15", "Sevenhill", "Sevenhill", "Vinavie", "Project", 6, null),
  C("c16", "Vegetation Solutions — MVS", "Vegetation Solutions — MVS", "Vinavie", "Hourly", null, { "2026-01": 3.8, "2026-02": 3.6, "2026-03": 3.5, "2026-04": 1.3, "2026-05": 1.2, "2026-06": 0.4 }),
  C("c17", "Vegetation Solutions — Firewood", "Vegetation Solutions — Firewood", "Vinavie", "Hourly", null, { "2026-01": 1.3, "2026-02": 2.5, "2026-03": 22.4, "2026-04": 21.1, "2026-05": 19.3, "2026-06": 13.0 }),

  C("c18", "Aus3C", "Aus3C", "Shreya", "Package", 40, { "2026-01": 35.0, "2026-02": 58.9, "2026-03": 56.0, "2026-04": 27.4, "2026-05": 67.6, "2026-06": 18.6 }),
  C("c19", "GPEX", "GPEX", "Shreya", "Package", 70, { "2026-01": 0, "2026-02": 0, "2026-03": 0, "2026-04": 38.6, "2026-05": 105.3, "2026-06": 140.4 }),
  C("c20", "BusSA", "BusSA", "Shreya", "Project", 25, { "2026-01": 0, "2026-02": 1.5, "2026-03": 9.0, "2026-04": 18.8, "2026-05": 46.5, "2026-06": 19.0 }),
  C("c21", "Magain Real Estate", "Magain Real Estate", "Shreya", "Hourly", null, { "2026-01": 13.1, "2026-02": 8.8, "2026-03": 42.9, "2026-04": 24.0, "2026-05": 10.3, "2026-06": 7.6 }),
  C("c22", "Media Magnetix", "Media Magnetix", "Shreya", "Strategy", 0, null),

  C("c23", "Baintech", "Baintech", "Lucy", "Package", 38, null),
  C("c24", "BAMSS / Childcare Sec Services", "BAMSS", "Lucy", "Package", 22, { "2026-01": 0, "2026-02": 0, "2026-03": 0, "2026-04": 4.7, "2026-05": 5.8, "2026-06": 13.9 }),
  C("c25", "Barclay Recruitment (Verity Cons)", "Barclay Recruitment", "Lucy", "Package", 27, { "2026-01": 0, "2026-02": 0, "2026-03": 0, "2026-04": 0, "2026-05": 14.9, "2026-06": 48.5 }),
  C("c26", "Bridge to Best", "Bridge to Best", "Lucy", "Package", 10, null),
  C("c27", "By the Rules", "By the Rules", "Lucy", "Package", 5, null),
  C("c28", "Connection Central", "Connection Central", "Lucy", "Project", 25, null),
  C("c29", "Cowie Environmental", "Cowie Environmental", "Lucy", "Package", 16, { "2026-01": 0, "2026-02": 0, "2026-03": 0, "2026-04": 31.7, "2026-05": 16.2, "2026-06": 33.5 }),
  C("c30", "CRA Construction", "CRA Construction", "Lucy", "Package", 24, { "2026-01": 0, "2026-02": 0, "2026-03": 0, "2026-04": 7.8, "2026-05": 25.7, "2026-06": 23.5 }),
  C("c31", "May Di Marco – Ray White", "May Di Marco", "Lucy", "Package", 11, { "2026-01": 0, "2026-02": 0, "2026-03": 0, "2026-04": 4.7, "2026-05": 6.4, "2026-06": 11.5 }),
  C("c32", "Plumbaround", "Plumbaround", "Lucy", "Package", 16, null),
  C("c33", "Sunfresh Linen", "Sunfresh Linen", "Lucy", "Package", 22, { "2026-01": 0, "2026-02": 0, "2026-03": 0.3, "2026-04": 22.6, "2026-05": 21.7, "2026-06": 32.9 }),

  C("c34", "Bee Squared Consulting", "Bee Squared", "Holly", "Package", 24, { "2026-01": 29.1, "2026-02": 25.7, "2026-03": 24.4, "2026-04": 13.4, "2026-05": 30.1, "2026-06": 29.4 }),
  C("c35", "Comunet", "Comunet", "Holly", "Hourly", 32, { "2026-01": 22.8, "2026-02": 21.8, "2026-03": 20.8, "2026-04": 6.8, "2026-05": 47.4, "2026-06": 32.8 }),
  C("c36", "Clarke Energy (base)", "Clarke Energy", "Holly", "Hourly", null, { "2026-01": 26.9, "2026-02": 37.2, "2026-03": 48.1, "2026-04": 26.0, "2026-05": 67.2, "2026-06": 112.3 }),
  C("c37", "Clarke Energy — AEP", "Clarke Energy", "Holly", "Hourly", null, null),
  C("c38", "Clarke Energy — ACES", "Clarke Energy", "Holly", "Hourly", null, null),
  C("c39", "Clarke Energy — AIMEX", "Clarke Energy", "Holly", "Hourly", null, null),
  C("c40", "Clarke Energy — WA", "Clarke Energy", "Holly", "Hourly", null, null),
  C("c41", "History Trust of SA", "History Trust of SA", "Holly", "MAP", 80, { "2026-01": 0, "2026-02": 0, "2026-03": 0, "2026-04": 0, "2026-05": 28.1, "2026-06": 82.6 }),
  C("c42", "PRG Consulting", "PRG Consulting", "Holly", "Package", 8, { "2026-01": 13.5, "2026-02": 15.4, "2026-03": 13.1, "2026-04": 1.0, "2026-05": 5.0, "2026-06": 5.4 }),
  C("c43", "Utter Gutters", "Utter Gutters", "Holly", "Package", 32, { "2026-01": 8.2, "2026-02": 6.5, "2026-03": 6.2, "2026-04": 6.0, "2026-05": 7.1, "2026-06": 9.0 }),
  C("c44", "Villani Jewellers", "Villani Jewellers", "Holly", "Package", 16, { "2026-01": 12.8, "2026-02": 16.8, "2026-03": 16.5, "2026-04": 20.9, "2026-05": 16.8, "2026-06": 12.9 }),
  C("c45", "Villani — Website Project", "Villani Jewellers", "Holly", "Project", 8, null),

  C("c46", "Better Medical", "Better Medical", "Alice", "Package", 32, { "2026-01": 48.0, "2026-02": 43.6, "2026-03": 47.6, "2026-04": 32.9, "2026-05": 18.1, "2026-06": 47.7 }),
  C("c47", "Duco", "Duco", "Alice", "Package", 24, { "2026-01": 16.2, "2026-02": 34.8, "2026-03": 25.6, "2026-04": 27.2, "2026-05": 3.3, "2026-06": 0.0 }),
  C("c48", "Osteria Polpo", "Osteria Polpo", "Alice", "Package", 16, null),
  C("c49", "Sidewood", "Sidewood", "Alice", "Hourly", null, { "2026-01": 26.6, "2026-02": 32.4, "2026-03": 37.8, "2026-04": 30.0, "2026-05": 31.8, "2026-06": 30.3 }),
  C("c50", "Your Success Lab", "Your Success Lab", "Alice", "Package", 40, { "2026-01": 0, "2026-02": 0, "2026-03": 33.8, "2026-04": 61.6, "2026-05": 33.2, "2026-06": 35.1 }),

  C("c51", "Blueforce", "Blueforce", "Amanda", "Package", 40, { "2026-01": 0, "2026-02": 0, "2026-03": 6.4, "2026-04": 27.2, "2026-05": 47.2, "2026-06": 51.4 }),
  C("c52", "CLT Website", "CLT Website", "Amanda", "Package", null, null),
  C("c53", "Filter Supplies (WA)", "Filter Supplies", "Amanda", "Package", 16, { "2026-01": 6.4, "2026-02": 9.8, "2026-03": 14.0, "2026-04": 17.8, "2026-05": 8.1, "2026-06": 15.0 }),
  C("c54", "Green Shoots", "Green Shoots", "Amanda", "Package", 16, { "2026-01": 19.2, "2026-02": 6.6, "2026-03": 13.9, "2026-04": 7.5, "2026-05": 19.3, "2026-06": 24.8 }),
  C("c55", "Majestic Plumbing", "Majestic Plumbing", "Amanda", "Package", 16, { "2026-01": 0, "2026-02": 0, "2026-03": 4.6, "2026-04": 11.7, "2026-05": 15.9, "2026-06": 32.2 }),
  C("c56", "Rent Busters WA", "Rent Busters WA", "Amanda", "Package", 8, { "2026-01": 6.1, "2026-02": 6.6, "2026-03": 6.2, "2026-04": 8.3, "2026-05": 7.0, "2026-06": 7.0 }),
  C("c57", "Zest", "Zest", "Amanda", "Package", 24, { "2026-01": 1.3, "2026-02": 36.6, "2026-03": 18.8, "2026-04": 42.7, "2026-05": 22.9, "2026-06": 1.3 }),
];

const SEED_SUPPORT = [
  { id: "s1", from: "Vinavie", to: "Holly", type: "pct", value: 0.30 },
  { id: "s2", from: "Ariani", to: "Holly", type: "pct", value: 0.20 },
  { id: "s3", from: "Chelsea", to: "Holly", type: "pct", value: 0.35 },
  { id: "s4", from: "Ariani", to: "Shreya", type: "pct", value: 0.20 },
  { id: "s5", from: "Alex", to: "Shreya", type: "pct", value: 0.75 },
  { id: "s6", from: "Vinavie", to: "Shreya", type: "pct", value: 0.30 },
  { id: "s7", from: "Ariani", to: "Chloe", type: "pct", value: 0.10 },
  { id: "s8", from: "Alex", to: "Chloe", type: "pct", value: 0.05 },
  { id: "s9", from: "DMA (external)", to: "Alice", type: "hours", value: 23 },
  { id: "s10", from: "Chelsea", to: "Alice", type: "pct", value: 0.35 },
  { id: "s11", from: "Ariani", to: "Alice", type: "pct", value: 0.20 },
  { id: "s12", from: "Ariani", to: "Amanda", type: "pct", value: 0.20 },
  { id: "s13", from: "Chelsea", to: "Amanda", type: "pct", value: 0.30 },
  { id: "s14", from: "DMA (external)", to: "Amanda", type: "hours", value: 9 },
  { id: "s15", from: "DMA (external)", to: "Vinavie", type: "hours", value: 5 },
  { id: "s16", from: "Ariani", to: "Vinavie", type: "pct", value: 0.10 },
  { id: "s17", from: "Vino", to: "Lucy", type: "hours", value: 99 },
  { id: "s18", from: "Julia", to: "Lucy", type: "hours", value: 99 },
  { id: "s19", from: "Ariani", to: "Lucy", type: "pct", value: 0.10 },
  { id: "s20", from: "Alex", to: "Purple Giraffe (internal)", type: "pct", value: 0.20 },
];

const OWNERS = ["Holly", "Shreya", "Chloe", "Alice", "Amanda", "Lucy", "Vinavie"];

/* ============================================================
   STORAGE — plain localStorage (the source component targeted a
   sandboxed window.storage API that doesn't exist in a standalone
   browser; same fix already applied to the reconciliation module).
============================================================ */
function loadKey(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}
function saveKey(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
}

/* ============================================================
   PICKER — dropdown trigger + menu, styled like the app's export menu
============================================================ */
function Picker({ value, label, options, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const current = options.find((o) => o.value === value);
  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button type="button" className="pg-select" style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setOpen((o) => !o)}>
        <span>{current ? current.label : (label || "Select…")}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="pg-menu" style={{ minWidth: 220, maxHeight: 240, overflow: "auto" }}>
          {options.map((o) => (
            <button key={o.value} type="button" className="pg-menu-item" style={{ justifyContent: "space-between" }} onClick={() => { onChange(o.value); setOpen(false); }}>
              <span>{o.label}</span>
              {o.sub && <span style={{ color: "var(--fg-tertiary)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{o.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SearchBox({ label, value, onChange }) {
  return (
    <label className="pg-field">
      <span className="pg-field__label"><Search size={11} /> {label}</span>
      <input className="pg-input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={`Search ${label.toLowerCase()}…`} />
    </label>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("CapacityDashboard error:", error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, padding: 24, margin: 24, color: "var(--status-over)", background: "var(--status-over-soft)", borderRadius: "var(--app-radius)", whiteSpace: "pre-wrap" }}>
          <b>Something broke while rendering this dashboard:</b>
          {"\n\n"}{String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error)}
          {"\n\n"}{this.state.error && this.state.error.stack}
        </div>
      );
    }
    return this.props.children;
  }
}

/* ============================================================
   MAIN COMPONENT
============================================================ */
function CapacityDashboardInner() {
  const [loaded, setLoaded] = useState(false);
  const [people, setPeople] = useState(SEED_PEOPLE);
  const [clients, setClients] = useState(SEED_CLIENTS);
  const [support, setSupport] = useState(SEED_SUPPORT);
  const [notes, setNotes] = useState([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [editNotes, setEditNotes] = useState(false);
  const [editRoster, setEditRoster] = useState(false);
  const [leaves, setLeaves] = useState({}); // key: `${personId}_${month}` -> hours
  const [overrides, setOverrides] = useState({}); // key: `${clientId}_${month}` -> manually-set Projected Hrs
  const [editingDemand, setEditingDemand] = useState(null); // which consultant's client table is in edit mode
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [savedAt, setSavedAt] = useState(null);
  const [collapsed, setCollapsed] = useState({});
  const [editingCard, setEditingCard] = useState(null);
  const [addForm, setAddForm] = useState({ from: "", type: "pct", value: "" });

  const [qConsultant, setQConsultant] = useState("");
  const [qClient, setQClient] = useState("");
  const [qSupport, setQSupport] = useState("");

  useEffect(() => {
    setPeople(loadKey("cap_people", SEED_PEOPLE));
    setClients(loadKey("cap_clients", SEED_CLIENTS));
    setSupport(loadKey("cap_support", SEED_SUPPORT));

    const loadedNotes = loadKey("cap_notes", []);
    if (Array.isArray(loadedNotes)) {
      setNotes(loadedNotes.every((n) => n && typeof n.text === "string") ? loadedNotes : []);
    } else if (typeof loadedNotes === "string" && loadedNotes.trim()) {
      setNotes([{ id: uid("n"), text: loadedNotes.trim(), ts: Date.now() }]);
    } else {
      setNotes([]);
    }

    setLeaves(loadKey("cap_leaves", {}));
    setOverrides(loadKey("cap_overrides", {}));
    setLoaded(true);
  }, []);
  useEffect(() => { if (loaded) { saveKey("cap_people", people); setSavedAt(Date.now()); } }, [people, loaded]);
  useEffect(() => { if (loaded) { saveKey("cap_clients", clients); setSavedAt(Date.now()); } }, [clients, loaded]);
  useEffect(() => { if (loaded) { saveKey("cap_support", support); setSavedAt(Date.now()); } }, [support, loaded]);
  useEffect(() => { if (loaded) { saveKey("cap_notes", notes); setSavedAt(Date.now()); } }, [notes, loaded]);
  useEffect(() => { if (loaded) { saveKey("cap_leaves", leaves); setSavedAt(Date.now()); } }, [leaves, loaded]);
  useEffect(() => { if (loaded) { saveKey("cap_overrides", overrides); setSavedAt(Date.now()); } }, [overrides, loaded]);

  const resetSample = useCallback(() => { setPeople(SEED_PEOPLE); setClients(SEED_CLIENTS); setSupport(SEED_SUPPORT); setNotes([]); setLeaves({}); setOverrides({}); }, []);
  const addNote = () => {
    if (!noteDraft.trim()) return;
    setNotes((ns) => [{ id: uid("n"), text: noteDraft.trim(), ts: Date.now() }, ...ns]);
    setNoteDraft("");
  };
  const removeNote = (id) => setNotes((ns) => ns.filter((n) => n.id !== id));
  const leaveFor = (personId) => Number(leaves[`${personId}_${month}`] || 0);
  const setLeaveFor = (personId, hrs) => setLeaves((prev) => ({ ...prev, [`${personId}_${month}`]: hrs === "" ? 0 : Number(hrs) }));

  /* ---------- capacity math ---------- */
  const peopleMap = useMemo(() => {
    const m = {};
    const wd = weekdaysInMonth(month);
    people.forEach((p) => {
      const dailyHrs = p.contracted / 5;
      const resourceHours = dailyHrs * wd;                       // Total Resource Hours (monthly, weekday-exact)
      const holidayDays = publicHolidayDays(p.state, month);
      const publicHolidayHrs = dailyHrs * holidayDays;            // Public Holidays (hrs lost, state-specific)
      const leaveHrs = leaveFor(p.id);                            // Leaves (editable, hrs lost)
      const totalMonthlyHours = Math.max(0, resourceHours - publicHolidayHrs - leaveHrs);
      const monthly = totalMonthlyHours * p.rate;                 // Total Monthly Billable Capacity
      m[p.name] = { ...p, resourceHours, publicHolidayHrs, holidayDays, leaveHrs, totalMonthlyHours, monthly };
    });
    return m;
  }, [people, month, leaves]);

  const hoursOf = useCallback((entry) => {
    if (entry.type === "pct") { const base = peopleMap[entry.from] ? peopleMap[entry.from].monthly : 0; return base * Number(entry.value || 0); }
    return Number(entry.value || 0);
  }, [peopleMap]);

  const givenAway = useMemo(() => { const m = {}; support.forEach((s) => { m[s.from] = (m[s.from] || 0) + hoursOf(s); }); return m; }, [support, hoursOf]);
  const receivedBy = useMemo(() => { const m = {}; support.forEach((s) => { if (!m[s.to]) m[s.to] = []; m[s.to].push({ ...s, hours: hoursOf(s) }); }); return m; }, [support, hoursOf]);

  function trailingAverage(actuals, m) {
    if (!actuals) return null;
    const vals = Object.keys(actuals).filter((k) => k < m).sort().map((k) => actuals[k]);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  function demandFor(c, m) {
    const avg = trailingAverage(c.actuals, m);
    const isFixed = FIXED_BASES.includes(c.basis);
    let demand;
    if (isFixed) { demand = (c.agreed !== null && c.agreed !== undefined) ? c.agreed : (avg !== null ? avg : 0); }
    else { demand = avg !== null ? avg : (c.agreed !== null ? c.agreed : 0); }
    const overrideKey = `${c.id}_${m}`;
    const overridden = overrides[overrideKey];
    if (overridden !== undefined && overridden !== null && overridden !== "") { demand = Number(overridden); }
    return { demand, avg, isOverridden: overridden !== undefined && overridden !== null && overridden !== "" };
  }
  const setOverride = (clientId, m, value) => setOverrides((prev) => ({ ...prev, [`${clientId}_${m}`]: value === "" ? null : Number(value) }));

  const groupedByOwner = useMemo(() => {
    const m = {};
    OWNERS.forEach((o) => m[o] = []);
    const seenGroups = {};
    clients.forEach((c) => {
      if (!m[c.lead]) return;
      if (!seenGroups[c.group]) { seenGroups[c.group] = { group: c.group, lead: c.lead, rows: [] }; m[c.lead].push(seenGroups[c.group]); }
      seenGroups[c.group].rows.push(c);
    });
    return m;
  }, [clients]);

  const demandByOwner = useMemo(() => {
    const m = {};
    clients.forEach((c) => { const { demand } = demandFor(c, month); m[c.lead] = (m[c.lead] || 0) + demand; });
    return m;
  }, [clients, month, overrides]);

  const personCalc = useMemo(() => {
    const m = {};
    people.forEach((p) => {
      const base = peopleMap[p.name].monthly;
      const away = givenAway[p.name] || 0;
      const remainderAfterAway = base - away; // what's left after committing hours to others — can go negative if over-promised
      const ownAvailable = Math.max(0, remainderAfterAway);
      const received = receivedBy[p.name] || [];
      const receivedTotal = received.reduce((s, r) => s + r.hours, 0);
      const pool = ownAvailable + receivedTotal;
      const demand = demandByOwner[p.name] || 0;
      const headroom = pool - demand;
      const usedOwnOnClients = Math.min(demand, ownAvailable); // her own claim, capped — can't claim more than she actually has left
      const allocatedTotal = away + usedOwnOnClients; // Allocated Hours = given to others + spent on her own clients
      const spare = remainderAfterAway - usedOwnOnClients; // Availability = capacity − Allocated Hours. Never goes negative just because her own client list is bigger than her capacity — only if she's over-promised hours to others.
      const overAllocated = spare < 0;
      m[p.name] = { base, away, ownAvailable, received, receivedTotal, pool, demand, headroom, spare, overAllocated, usedOwnOnClients, allocatedTotal };
    });
    return m;
  }, [people, peopleMap, givenAway, receivedBy, demandByOwner]);

  const totalDemand = useMemo(() => clients.reduce((s, c) => s + demandFor(c, month).demand, 0), [clients, month, overrides]);
  const totalCapacity = useMemo(() => people.reduce((s, p) => s + peopleMap[p.name].monthly, 0), [people, peopleMap]);
  const totalDMA = useMemo(() => support.filter((s) => s.from === "DMA (external)").reduce((s, x) => s + hoursOf(x), 0), [support, hoursOf]);
  const totalBillableAllocation = totalCapacity + totalDMA; // total hours the team+DMA is available to deliver
  const difference = totalBillableAllocation - totalDemand;

  /* ---------- filtering ---------- */
  const supportersOf = (owner) => (personCalc[owner] ? personCalc[owner].received.map((r) => r.from) : []);
  const visibleOwners = OWNERS.filter((owner) => {
    const okConsultant = !qConsultant || owner.toLowerCase().includes(qConsultant.toLowerCase());
    const okClient = !qClient || (groupedByOwner[owner] || []).some((g) => g.group.toLowerCase().includes(qClient.toLowerCase()) || g.rows.some((r) => r.client.toLowerCase().includes(qClient.toLowerCase())));
    const okSupport = !qSupport || supportersOf(owner).some((n) => n.toLowerCase().includes(qSupport.toLowerCase()));
    return okConsultant && okClient && okSupport;
  });

  const toggleCollapse = (owner) => setCollapsed((prev) => ({ ...prev, [owner]: !prev[owner] }));
  const fmt = (n) => (n === null || n === undefined) ? "—" : Number(n).toFixed(1);
  const monthIdx = MONTHS.indexOf(month);
  const shiftMonth = (d) => setMonth(MONTHS[Math.max(0, Math.min(MONTHS.length - 1, monthIdx + d))]);
  const monthKind = month < CURRENT_MONTH ? "past" : (month === CURRENT_MONTH ? "now" : "future");

  const allocatableNames = ["DMA (external)", ...people.map((p) => p.name)];

  const removeSupport = (id) => setSupport((ss) => ss.filter((s) => s.id !== id));
  const updateSupportValue = (id, newValue) => setSupport((ss) => ss.map((s) => s.id === id ? { ...s, value: newValue } : s));
  const updatePerson = (id, field, value) => setPeople((ps) => ps.map((p) => p.id === id ? { ...p, [field]: value } : p));
  function proposedHours(from, type, value) {
    if (type === "pct") { const base = peopleMap[from] ? peopleMap[from].monthly : 0; return base * Number(value || 0); }
    return Number(value || 0);
  }
  function wouldExceed(from, newHours) {
    if (from === "DMA (external)") return { over: false, base: null, currentAway: 0, total: newHours };
    const base = peopleMap[from] ? peopleMap[from].monthly : 0;
    const currentAway = givenAway[from] || 0;
    const ownDemand = demandByOwner[from] || 0; // if `from` is themselves a consultant, their own clients get first call on their hours
    const total = currentAway + newHours + ownDemand;
    return { over: total > base, base, currentAway, ownDemand, total };
  }
  function submitAllocation(toConsultant) {
    const { from, type, value } = addForm;
    if (!from || value === "" || value === null) return;
    setSupport((ss) => [...ss, { id: uid("s"), from, to: toConsultant, type, value: Number(value) }]);
    setAddForm({ from: "", type: "pct", value: "" });
  }

  function exportCSV() {
    const rows = [["Name", "Role", "State", "Total Resource Hours", "Leaves", "Public Holidays", "Total Monthly Hours", "Billable Allocation %", "Total Monthly Billable Capacity", "Allocated Hours", "Availability"]];
    people.forEach((p) => { const pc = personCalc[p.name]; const pm = peopleMap[p.name]; rows.push([p.name, p.role, p.state, pm.resourceHours.toFixed(1), pm.leaveHrs.toFixed(1), pm.publicHolidayHrs.toFixed(1), pm.totalMonthlyHours.toFixed(1), (p.rate * 100).toFixed(0) + "%", pc.base.toFixed(1), pc.allocatedTotal.toFixed(1), pc.spare.toFixed(1)]); });
    rows.push([]); rows.push(["Total Demand", totalDemand.toFixed(1)]);
    rows.push(["Total Billable Allocation", totalBillableAllocation.toFixed(1)]);
    rows.push(["Difference", difference.toFixed(1)]);
    const csv = rows.map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `capacity-ledger-${month}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  if (!loaded) {
    return <div className="pg-cap-container"><div className="pg-empty">Loading…</div></div>;
  }

  return (
    <div className="pg-cap-container">
      <div className="pg-app-header">
        <div>
          <span className="pg-eyebrow">Purple Giraffe · Internal</span>
          <h1 className="pg-app-header__title">Do we have the bandwidth?</h1>
          <p className="pg-app-header__sub">Capacity ledger — team hours vs. client demand, by month.</p>
        </div>
        {savedAt && (
          <span className="pg-tag" style={{ color: "var(--status-ok)", display: "inline-flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
            <Check size={12} /> saved
          </span>
        )}
      </div>

      <div className="pg-panel" style={{ alignItems: "center" }}>
        <span className="pg-field__label">Month</span>
        <button className="pg-btn-ghost" style={{ padding: "7px 9px" }} onClick={() => shiftMonth(-1)} disabled={monthIdx === 0}><ChevronLeft size={13} /></button>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 18, minWidth: 76, textAlign: "center" }}>{MONTH_LABELS[month]}</span>
        <button className="pg-btn-ghost" style={{ padding: "7px 9px" }} onClick={() => shiftMonth(1)} disabled={monthIdx === MONTHS.length - 1}><ChevronRight size={13} /></button>
        <span className="pg-tag" style={{ color: monthKind === "past" ? "var(--fg-tertiary)" : monthKind === "now" ? "var(--status-ok)" : "var(--accent)" }}>
          [{monthKind === "past" ? "past record" : monthKind === "now" ? "latest actuals" : "forecast"}]
        </span>
        <button className="pg-btn-ghost" style={{ marginLeft: "auto" }} onClick={resetSample}>Reset sample data</button>
      </div>

      <div className="pg-panel">
        <SearchBox label="Consultant" value={qConsultant} onChange={setQConsultant} />
        <SearchBox label="Client" value={qClient} onChange={setQClient} />
        <SearchBox label="Support hrs" value={qSupport} onChange={setQSupport} />
        <button className="pg-btn" style={{ marginLeft: "auto" }} onClick={exportCSV}><Download size={14} /> Export</button>
      </div>

      <div className="pg-cap-grid">

        {/* ===================== LEFT: CONSULTANT CARDS ===================== */}
        <div>
          {visibleOwners.length === 0 && <div className="pg-empty">No consultant matches all three search filters.</div>}

          {visibleOwners.map((owner) => {
            const pc = personCalc[owner];
            const groups = groupedByOwner[owner] || [];
            const isCollapsed = collapsed[owner];
            const isEditing = editingCard === owner;
            const candidateOptions = allocatableNames.filter((n) => n !== owner).map((n) => {
              const spare = n === "DMA (external)" ? null : (personCalc[n] ? personCalc[n].spare : 0);
              return { value: n, label: n, sub: spare === null ? "external" : `${spare.toFixed(1)} hrs spare` };
            });
            const preview = addForm.from ? proposedHours(addForm.from, addForm.type, addForm.value) : 0;
            const check = addForm.from ? wouldExceed(addForm.from, preview) : null;

            return (
              <div className="pg-cap-card" key={owner}>
                <button className="pg-client__name" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => toggleCollapse(owner)}>
                  {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                  {owner}
                  <span className="pg-tag" style={{ color: "var(--accent)" }}>[Consultant]</span>
                </button>

                {!isCollapsed && (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
                      <span className="pg-field__label">Client projects</span>
                      <button className="pg-btn-ghost" onClick={() => setEditingDemand(editingDemand === owner ? null : owner)}>
                        {editingDemand === owner ? <><Check size={11} /> done</> : <><Pencil size={11} /> edit</>}
                      </button>
                    </div>
                    <table className="pg-table">
                      <thead><tr><th>Client</th><th>Type</th><th className="right num">Agreed Hrs</th><th className="right num">Average Hrs</th><th className="right num">Projected Hrs</th></tr></thead>
                      <tbody>
                        {groups.map((g) => {
                          const isMulti = g.rows.length > 1;
                          const gDemand = g.rows.reduce((s, r) => s + demandFor(r, month).demand, 0);
                          if (!isMulti) {
                            const r = g.rows[0];
                            const { demand, avg, isOverridden } = demandFor(r, month);
                            return (
                              <tr key={g.group}>
                                <td>{r.client}</td>
                                <td><span className="pg-tag" style={{ color: "var(--accent)" }}>[{r.basis}]</span></td>
                                <td className="right num">{fmt(r.agreed)}</td>
                                <td className="right num">{fmt(avg)}</td>
                                <td className="right num">
                                  {editingDemand === owner ? (
                                    <input className="pg-input" type="number" step="any" style={{ width: 72, padding: "4px 6px" }}
                                      value={demand} onChange={(e) => setOverride(r.id, month, e.target.value)} />
                                  ) : (
                                    <>
                                      <b>{demand.toFixed(1)}</b>
                                      {isOverridden && <span className="pg-tag" style={{ color: "var(--accent)", marginLeft: 6 }}>[manual]</span>}
                                    </>
                                  )}
                                </td>
                              </tr>
                            );
                          }
                          return (
                            <tr key={g.group}>
                              <td>{g.group} <span style={{ fontSize: 10, color: "var(--fg-tertiary)" }}>({g.rows.length} sub-projects)</span></td>
                              <td><span className="pg-tag pg-tag--muted">[Combined]</span></td>
                              <td className="right num">—</td><td className="right num">—</td>
                              <td className="right num"><b>{gDemand.toFixed(1)}</b></td>
                            </tr>
                          );
                        })}
                        <tr className="total"><td colSpan={4}>Total</td><td className="right num">{pc.demand.toFixed(1)}</td></tr>
                      </tbody>
                    </table>
                    {editingDemand === owner && <p className="pg-footnote" style={{ marginTop: 8 }}>Combined multi-project clients (e.g. Clarke Energy) aren't directly editable here yet — edit their individual agreed hours or actuals in the underlying data.</p>}

                    <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px dashed var(--border-soft)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span className="pg-field__label">Capacity planning</span>
                        <button className="pg-btn-ghost" onClick={() => { setEditingCard(isEditing ? null : owner); setAddForm({ from: "", type: "pct", value: "" }); }}>
                          {isEditing ? <><Check size={11} /> done</> : <><Pencil size={11} /> edit</>}
                        </button>
                      </div>
                      <table className="pg-table">
                        <thead><tr><th>Capacity</th><th>Allocation</th><th className="right num">Hrs</th>{isEditing && <th></th>}</tr></thead>
                        <tbody>
                          <tr>
                            <td>{owner} (own time)</td>
                            <td>{pc.base > 0 ? ((pc.usedOwnOnClients / pc.base) * 100).toFixed(0) : 0}% of their time</td>
                            <td className="right num">{pc.usedOwnOnClients.toFixed(1)}</td>
                            {isEditing && <td></td>}
                          </tr>
                          {pc.received.length === 0 && <tr><td colSpan={4} className="empty">No additional support currently allocated.</td></tr>}
                          {pc.received.map((r, i) => {
                            const supporterOver = r.from !== "DMA (external)" && personCalc[r.from] && personCalc[r.from].overAllocated;
                            return (
                              <tr key={i}>
                                <td>{r.from} {supporterOver && <span className="pg-tag" style={{ color: "var(--status-over)", marginLeft: 6 }}>[over cap]</span>}</td>
                                <td>
                                  {isEditing ? (
                                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                      <input className="pg-input" type="number" step="any" style={{ width: 64, padding: "4px 6px" }}
                                        value={r.type === "pct" ? Math.round(r.value * 1000) / 10 : r.value}
                                        onChange={(e) => {
                                          const v = e.target.value === "" ? 0 : Number(e.target.value);
                                          updateSupportValue(r.id, r.type === "pct" ? v / 100 : v);
                                        }} />
                                      <span style={{ fontSize: 11, color: "var(--fg-tertiary)" }}>{r.type === "pct" ? "% of their time" : "fixed hrs"}</span>
                                    </span>
                                  ) : (
                                    r.type === "pct" ? `${(r.value * 100).toFixed(0)}% of their time` : `${r.value} fixed hrs`
                                  )}
                                </td>
                                <td className="right num">{r.hours.toFixed(1)}</td>
                                {isEditing && <td><button className="pg-btn-ghost" style={{ color: "var(--status-over)", padding: "4px 7px" }} onClick={() => removeSupport(r.id)}><X size={12} /></button></td>}
                              </tr>
                            );
                          })}
                          <tr className="total"><td colSpan={2}>Total capacity assembled for {owner}</td><td className="right num">{(pc.usedOwnOnClients + pc.receivedTotal).toFixed(1)}</td>{isEditing && <td></td>}</tr>
                        </tbody>
                      </table>

                      {isEditing && (
                        <div className="pg-cap-addform">
                          <div className="pg-cap-addform-grid">
                            <div><Picker value={addForm.from} label="Choose person" options={candidateOptions} onChange={(v) => setAddForm((f) => ({ ...f, from: v }))} /></div>
                            <div><Picker value={addForm.type} options={[{ value: "pct", label: "% of their time" }, { value: "hours", label: "Fixed hours" }]} onChange={(v) => setAddForm((f) => ({ ...f, type: v }))} /></div>
                            <div><input className="pg-input" type="number" step="any" placeholder={addForm.type === "pct" ? "0.20" : "10"} value={addForm.value} onChange={(e) => setAddForm((f) => ({ ...f, value: e.target.value }))} /></div>
                            <button className="pg-btn" style={{ padding: "9px 14px" }} onClick={() => submitAllocation(owner)} disabled={!addForm.from || addForm.value === ""}><Plus size={13} /> Add</button>
                          </div>
                          {check && check.over && (
                            <div className="pg-alertbar" style={{ background: "var(--status-over-soft)", color: "var(--status-over)", marginTop: 10 }}>
                              <AlertTriangle size={13} />
                              <span className="pg-alertbar__text">
                                Risk: {addForm.from} would be committing {check.total.toFixed(1)} hrs in total (their own {check.ownDemand.toFixed(1)} hrs of client work + {(check.currentAway + preview).toFixed(1)} hrs given to others) against a capacity of {check.base.toFixed(1)} hrs — {(check.total - check.base).toFixed(1)} hrs over.
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* ===================== RIGHT: ROSTER + STATS + NOTES ===================== */}
        <div>
          <div className="pg-table-wrap" style={{ overflowX: "auto" }}>
            <div className="pg-table-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Team roster</span>
              <button className="pg-btn-ghost" onClick={() => setEditRoster((v) => !v)}>{editRoster ? <><Check size={11} /> done</> : <><Pencil size={11} /> edit</>}</button>
            </div>
            <table className="pg-table" style={{ minWidth: 640 }}>
              <thead><tr><th>Consultant</th><th className="right num">Resource Hrs</th><th className="right num">Leaves</th><th className="right num">Public Hols</th><th className="right num">Monthly Hrs</th><th className="right num">Billable %</th><th className="right num">Billable Capacity</th><th className="right num">Allocated</th><th className="right num">Availability</th></tr></thead>
              <tbody>
                {people.map((p) => {
                  const pc = personCalc[p.name];
                  const pm = peopleMap[p.name];
                  return (
                    <tr key={p.id}>
                      <td>{p.name} <span className="pg-tag" style={{ color: p.role === "Consultant" ? "var(--accent)" : "var(--accent-orchid)", marginLeft: 5 }}>[{p.role[0]}]</span></td>
                      <td className="right num">{pm.resourceHours.toFixed(1)}</td>
                      <td className="right num">
                        {editRoster
                          ? <input className="pg-input" type="number" min="0" step="any" style={{ width: 60, padding: "4px 6px" }} value={leaveFor(p.id)} onChange={(e) => setLeaveFor(p.id, e.target.value)} />
                          : (leaveFor(p.id) > 0 ? leaveFor(p.id).toFixed(1) : "—")}
                      </td>
                      <td className="right num">{pm.publicHolidayHrs.toFixed(1)} <span style={{ color: "var(--fg-tertiary)", fontSize: 10 }}>({pm.holidayDays}d)</span></td>
                      <td className="right num">{pm.totalMonthlyHours.toFixed(1)}</td>
                      <td className="right num">
                        {editRoster
                          ? <input className="pg-input" type="number" min="0" max="100" step="1" style={{ width: 52, padding: "4px 6px" }} value={Math.round(p.rate * 100)} onChange={(e) => updatePerson(p.id, "rate", (e.target.value === "" ? 0 : Number(e.target.value)) / 100)} />
                          : `${(p.rate * 100).toFixed(0)}%`}
                      </td>
                      <td className="right num"><b>{pc.base.toFixed(1)}</b></td>
                      <td className="right num">{pc.allocatedTotal > 0 ? pc.allocatedTotal.toFixed(1) : "—"}</td>
                      <td className="right num" style={{ color: pc.spare < 0 ? "var(--status-over)" : "var(--status-ok)" }}>{pc.spare > 0 ? "+" : ""}{pc.spare.toFixed(1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="pg-footnote">Total Resource Hours and Public Holidays are calculated from {MONTH_LABELS[month]}'s actual weekdays and each person's state. Leaves and Billable Allocation are only editable in Edit mode; everything else recalculates automatically.</p>

          <div className="pg-cap-statrow">
            <div className="pg-cap-stat"><div className="pg-stat__value">{totalDemand.toFixed(0)}</div><div className="pg-stat__label">Total demand</div></div>
            <div className="pg-cap-stat"><div className="pg-stat__value">{totalBillableAllocation.toFixed(0)}</div><div className="pg-stat__label">Billable allocation</div></div>
            <div className="pg-cap-stat"><div className="pg-stat__value" style={{ color: difference < 0 ? "var(--status-over)" : "var(--status-ok)" }}>{difference > 0 ? "+" : ""}{difference.toFixed(0)}</div><div className="pg-stat__label">Difference</div></div>
          </div>

          <div className="pg-cap-card" style={{ marginTop: 14 }}>
            <span className="pg-field__label">Add a note</span>
            <textarea className="pg-cap-textarea" style={{ marginTop: 8 }} value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="e.g. why a client is running over, staffing changes expected next month…" />
            <button className="pg-btn" style={{ marginTop: 8 }} onClick={addNote} disabled={!noteDraft.trim()}><Plus size={13} /> Add note</button>
          </div>

          <div className="pg-cap-card" style={{ marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="pg-field__label">Reference &amp; notes log</span>
              <button className="pg-btn-ghost" onClick={() => setEditNotes((v) => !v)}>{editNotes ? <><Check size={11} /> done</> : <><Pencil size={11} /> edit</>}</button>
            </div>

            <div style={{ marginTop: 12 }}>
              <span className="pg-field__label">Public holidays in {MONTH_LABELS[month]}</span>
              {(() => {
                const STATE_NAMES = { SA: "South Australia", WA: "Western Australia", QLD: "Queensland" };
                const items = holidaysInMonthGrouped(month);
                if (items.length === 0) return <p style={{ fontFamily: "var(--font-body)", fontSize: 12.5, color: "var(--fg-secondary)", marginTop: 8 }}>No public holidays fall in {MONTH_LABELS[month]} for SA, WA, or QLD.</p>;
                return items.map((item) => {
                  const parts = Object.entries(item.states).map(([st, name]) => `${STATE_NAMES[st]} (${name})`);
                  const sentence = parts.length === 1
                    ? `${item.dayLabel} ${MONTH_LABELS[month].split(" ")[0]} is a public holiday in ${parts[0]}.`
                    : `${item.dayLabel} ${MONTH_LABELS[month].split(" ")[0]} is a public holiday in ${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}.`;
                  return <p key={item.date} style={{ fontFamily: "var(--font-body)", fontSize: 12.5, color: "var(--fg-secondary)", marginTop: 8 }}>{sentence}</p>;
                });
              })()}
              <p className="pg-footnote" style={{ marginTop: 8 }}>Sourced from each state's official 2026 public holiday calendar — Christmas Eve/New Year's Eve part-day holidays and weekend-falling dates with no substitute aren't counted here since they don't affect a working day.</p>
            </div>

            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px dashed var(--border-soft)" }}>
              <span className="pg-field__label">Added notes</span>
              {notes.length === 0 && <p style={{ fontFamily: "var(--font-body)", fontSize: 11.5, color: "var(--fg-tertiary)", marginTop: 8 }}>No notes added yet.</p>}
              {notes.map((n) => (
                <div key={n.id} className="pg-cap-note-row">
                  <div>
                    <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--fg-secondary)" }}>{n.text}</div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-tertiary)", marginTop: 2 }}>{new Date(n.ts).toLocaleString()}</div>
                  </div>
                  {editNotes && <button className="pg-btn-ghost" style={{ color: "var(--status-over)", padding: "4px 7px" }} onClick={() => removeNote(n.id)}><X size={12} /></button>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <p className="pg-footnote">Purple Giraffe · Capacity Ledger · "Total Billable Allocation" = total team capacity + DMA hours · "Difference" = that total minus Total Demand</p>
    </div>
  );
}

export default function CapacityDashboard() {
  return (
    <ErrorBoundary>
      <CapacityDashboardInner />
    </ErrorBoundary>
  );
}
