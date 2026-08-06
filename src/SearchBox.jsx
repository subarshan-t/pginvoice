import React, { useMemo } from "react";
import { Search } from "lucide-react";
import { useDismissable } from "./useDismissable.js";

// Shared free-text filter + dropdown-of-matches box, used by Performance Scorecard
// (width 220) and Timesheet Summary (width 240) alike.
export function SearchBox({ label, value, onChange, options, onSelect, width = 240 }) {
  const [open, setOpen] = React.useState(false);
  const ref = useDismissable(() => setOpen(false));
  const matches = useMemo(() => {
    if (!options) return [];
    const q = (value || "").trim().toLowerCase();
    const pool = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
    return pool.slice(0, 8);
  }, [options, value]);
  return (
    <label className="pg-field" style={{ position: "relative", width }} ref={ref}>
      <span className="pg-field__label"><Search size={11} /> {label}</span>
      <input className="pg-input" value={value} onChange={(e) => { onChange(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder={`Search ${label.toLowerCase()}…`} autoComplete="off" />
      {open && options && matches.length > 0 && (
        <div className="pg-menu" style={{ width: "100%", top: "calc(100% + 2px)" }}>
          {matches.map((m) => (
            <button key={m} type="button" className="pg-menu-item" onClick={() => { onChange(m); if (onSelect) onSelect(m); setOpen(false); }}>{m}</button>
          ))}
        </div>
      )}
    </label>
  );
}
