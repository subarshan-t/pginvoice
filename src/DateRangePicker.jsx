import React, { useState } from "react";
import { DayPicker } from "react-day-picker";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useDismissable } from "./useDismissable.js";
import "react-day-picker/style.css";

// Every date this component deals with, in or out, is a plain "yyyy-mm-dd" civil-date
// string (the same shape month_key/date_key already use elsewhere in this app) -- never a
// Date parsed from that string directly. `new Date("2026-03-05")` parses as UTC midnight,
// which prints as March 4th in any timezone behind UTC -- the classic off-by-one-day
// calendar bug. These two helpers are the only places a Date ever gets constructed from or
// reduced to a string, always via local-time getters/constructors, never toISOString/UTC.
export function parseCivilDate(s) {
  if (!s) return undefined;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}
export function civilDateStr(date) {
  if (!date) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function formatCivil(s) {
  const d = parseCivilDate(s);
  return d ? d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
}

function Chevron({ orientation, ...props }) {
  return orientation === "left" ? <ChevronLeft size={16} {...props} /> : <ChevronRight size={16} {...props} />;
}

// Date field that opens a calendar popover for picking a range -- the shadcn/ui
// Popover+Calendar pattern, Calendar being a themed wrapper around react-day-picker's
// DayPicker. mode="range" gives the two endpoints range_start/range_end modifiers and the
// tinted days between them range_middle (styled in app.css's .pg-daterange block); the
// week grid keeps DayPicker's own keyboard model (arrow keys move by day/week, PageUp/
// PageDown by month) untouched -- nothing here overrides onKeyDown.
//
// `value`: { from: "yyyy-mm-dd" | null, to: "yyyy-mm-dd" | null }. `onChange` receives the
// same shape on every selection change, including the in-progress state where only `from`
// is set yet (so a controlling parent can show "Mar 5 – …" immediately rather than waiting
// for the second click) -- closes itself once both ends are picked.
export function DateRangePicker({ value, onChange, placeholder = "Pick a date range", numberOfMonths = 2, weekStartsOn = 1, align = "left" }) {
  const [open, setOpen] = useState(false);
  const ref = useDismissable(() => setOpen(false));

  const selected = { from: parseCivilDate(value?.from), to: parseCivilDate(value?.to) };
  const label = value?.from && value?.to ? `${formatCivil(value.from)} – ${formatCivil(value.to)}`
    : value?.from ? `${formatCivil(value.from)} – …`
    : placeholder;

  return (
    <div className={"pg-input pg-daterange" + (value?.from ? "" : " pg-daterange--empty")} ref={ref}>
      {/* A real button, not the outer div -- the Clear button below is a sibling of this,
          not a child, so there's no interactive-content-inside-a-button nesting (invalid
          HTML, unreliable for screen readers/tab order) between the two click targets. */}
      <button
        type="button" className="pg-daterange__trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog" aria-expanded={open}
      >
        <CalendarIcon size={14} />
        <span>{label}</span>
      </button>
      {value?.from && (
        <button
          type="button" aria-label="Clear date range"
          className="pg-daterange__clear"
          onClick={() => onChange({ from: null, to: null })}
        >
          <X size={12} />
        </button>
      )}
      {open && (
        <div className={`pg-daterange__popover pg-daterange__popover--${align}`} role="dialog" aria-label="Choose a date range">
          <DayPicker
            mode="range"
            // `required` -- without it, re-clicking the SAME day you just picked (the
            // natural "confirm this single day" gesture, since the first click already
            // sets to=from -- see the onSelect comment below) hits react-day-picker's
            // isSameDay(from,date) && isSameDay(to,date) branch, which DESELECTS
            // (range becomes undefined) rather than confirming -- silently wiping a
            // deliberately-picked one-day range back to empty. `required` changes that
            // one branch to keep {from, to} instead of clearing it; every other
            // click-ordering case (earlier-first, later-first, extending, shrinking) is
            // unaffected, since none of those branches read `required` at all.
            required
            selected={selected}
            onSelect={(range) => {
              // react-day-picker's own range logic sets `to` equal to `from` on the very
              // first click (a valid, deliberate 1-day range) -- not left undefined until a
              // second click. So "from and to are both set" alone can't be the close
              // signal, or the popover would close after every single click including the
              // first. Only the SECOND click of a two-click flow -- i.e. one landing on an
              // already-non-empty selection (including a re-click of the same day, now that
              // `required` keeps that as {from,to} instead of clearing it) -- should close it.
              const wasEmpty = !value?.from;
              onChange({ from: civilDateStr(range?.from), to: civilDateStr(range?.to) });
              if (!wasEmpty && range?.from && range?.to) setOpen(false);
            }}
            weekStartsOn={weekStartsOn}
            numberOfMonths={numberOfMonths}
            defaultMonth={selected.from || new Date()}
            components={{ Chevron }}
            className="pg-daterange__calendar"
          />
        </div>
      )}
    </div>
  );
}
