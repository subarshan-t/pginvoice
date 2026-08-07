import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { useDismissable } from "./useDismissable.js";

// Rounds for display only, to avoid floating-point round-trip jitter (e.g. 38/5 = 7.6)
// making the Days/Hrs fields visually disagree with each other.
const round1 = (n) => Math.round(n * 10) / 10;

/* ============================================================
   LEAVE EDITOR — a Days/Hrs popover replacing the old bare "hours" input.
   Leave is still stored (and passed around via onChange) as a single hours
   number, same as before -- this is purely a friendlier UI layer on top of
   leaveFor/setLeaveFor, so it stays in sync with Capacity Planning/Team via
   the existing cap_leaves + PG_DATA_EVENT mechanism automatically.
============================================================ */
export function LeaveEditor({ person, hours, onChange }) {
  const dailyHrs = person && person.contracted ? person.contracted / 5 : 0;
  const hoursForDays = (days) => days * dailyHrs;
  const daysForHours = (hrs) => (dailyHrs ? hrs / dailyHrs : 0);

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);

  const [daysStr, setDaysStr] = useState(String(round1(daysForHours(hours))));
  const [hrsStr, setHrsStr] = useState(String(round1(hours)));

  // `hours` prop is always the source of truth (the stored number) -- if it changes
  // externally (e.g. another module/tab updates cap_leaves and it echoes back via
  // PG_DATA_EVENT), resync local fields rather than holding a stale copy.
  useEffect(() => {
    setDaysStr(String(round1(daysForHours(hours))));
    setHrsStr(String(round1(hours)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours, dailyHrs]);

  const openMenu = () => {
    const r = btnRef.current.getBoundingClientRect();
    const menuWidth = 240;
    let left = r.right - menuWidth;
    if (left < 8) left = 8;
    let top = r.bottom + 4;
    const estMenuHeight = 170;
    if (top + estMenuHeight > window.innerHeight - 8) top = Math.max(8, r.top - estMenuHeight - 4);
    setPos({ top, left });
    setOpen(true);
  };

  const dismiss = useCallback(() => setOpen(false), []);
  const menuRef = useDismissable(dismiss, { extraRef: btnRef, onReposition: dismiss });

  const onDaysChange = (v) => {
    setDaysStr(v);
    const days = v === "" ? 0 : Number(v);
    if (Number.isNaN(days)) return;
    const newHours = round1(hoursForDays(days));
    setHrsStr(String(newHours));
    onChange(newHours);
  };

  const onHrsChange = (v) => {
    setHrsStr(v);
    const hrs = v === "" ? 0 : Number(v);
    if (Number.isNaN(hrs)) return;
    setDaysStr(String(round1(daysForHours(hrs))));
    onChange(hrs);
  };

  const label = hours ? `${round1(hours)} h` : "—";

  return (
    <>
      <button
        ref={btnRef} type="button" className="pg-btn-ghost" style={{ padding: "2px 7px", fontSize: 11 }}
        onClick={(e) => { e.stopPropagation(); open ? setOpen(false) : openMenu(); }}
        title={`Total hours of leave taken this month, not a day count -- a full day off for ${person.name} is ${round1(dailyHrs)} hrs.`}
      >
        {label}
      </button>
      {open && createPortal(
        <div ref={menuRef} className="pg-menu" style={{ position: "fixed", top: pos.top, left: pos.left, right: "auto", margin: 0, minWidth: 240, padding: 12, zIndex: 1000 }}>
          <div className="pg-field__label">Leave this month</div>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <div style={{ flex: 1 }}>
              <div className="pg-footnote" style={{ margin: "0 0 2px" }}>Days</div>
              <input
                className="pg-input" type="number" min="0" step="0.5" style={{ width: "100%" }}
                value={daysStr} disabled={!dailyHrs}
                onChange={(e) => onDaysChange(e.target.value)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div className="pg-footnote" style={{ margin: "0 0 2px" }}>Hrs</div>
              <input
                className="pg-input" type="number" min="0" step="any" style={{ width: "100%" }}
                value={hrsStr}
                onChange={(e) => onHrsChange(e.target.value)}
              />
            </div>
          </div>
          <p className="pg-footnote" style={{ marginTop: 8, marginBottom: 0 }}>
            {dailyHrs
              ? `1 day off ≈ ${round1(dailyHrs)} hrs for ${person.name}, based on their ${person.contracted} hrs/week.`
              : `${person.name} has no contracted hours/week set, so days can't be converted -- enter hours directly.`}
          </p>
          <button className="pg-btn" style={{ marginTop: 10, width: "100%", justifyContent: "center" }} onClick={() => setOpen(false)}>Done</button>
        </div>,
        document.body
      )}
    </>
  );
}
