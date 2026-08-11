import React, { useState } from "react";
import { Link2, MoreVertical, ChevronDown, Copy, Printer, Users } from "lucide-react";
import { fmt, isPackageLikeType } from "./format.js";
import { CLIENT_TYPE_TONES, TYPE_LABELS_SHORT } from "./nameMatch.js";
import { ClientAvatar } from "./avatar.jsx";
import { useDismissable } from "./useDismissable.js";
import { ExportItem } from "./ExportItem.jsx";

// The cost-centre breakdown for a client whose real work is logged across several
// sibling ClickUp folders instead of a single umbrella one (Aus3C's training programs,
// Majestic Plumbing's cost centres, ...) — multiFolderAccrualMatchesFor (nameMatch.js)
// already merges these into the parent row's package/worked/remaining figures; this is
// just a minimal, inline reveal of exactly which folders (including hours logged
// directly under the parent itself) added up to that total, styled as a plain
// timeline list rather than a second boxed table -- it's a footnote to the row above
// it, not a peer card of its own. A sibling folder that's deliberately EXCLUDED from
// the accrual (billed separately, e.g. a quoted one-off project) never appears here —
// it stays its own ordinary row, nested underneath via the existing sub-project
// mechanism (see the `nested` prop below), tagged "Sub project" rather than folded in.
function CostCentreBreakdown({ client: c }) {
  const { lineItems } = c.costCentre;
  return (
    <div className="pg-costcentre-mini">
      {lineItems.map((item) => (
        <div className="pg-costcentre-mini__row" key={item.name}>
          <span className="pg-costcentre-mini__dot" />
          <span className="pg-costcentre-mini__name">{item.name}</span>
          <span className="pg-costcentre-mini__hours">{fmt(item.hours)} h</span>
        </div>
      ))}
    </div>
  );
}

// Compact numbered row — the list's default state. Clicking anywhere on it opens
// the full client detail in the right-side drawer (see ClientDrawer.jsx).
export function ClientRow({ index, client: c, active, onOpen, nested, parentName, onCopy, onPdf }) {
  const [inlineOpen, setInlineOpen] = useState(false);
  // Cost-centre breakdown starts expanded — the whole point of showing it is to make
  // the roll-up visible by default, not to hide it behind another click.
  const [costCentreOpen, setCostCentreOpen] = useState(true);
  const [tasksAllShown, setTasksAllShown] = useState(false);
  const [consultantsAllShown, setConsultantsAllShown] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useDismissable(() => setMenuOpen(false));
  const isPackage = isPackageLikeType(c.type);
  const statusTone = isPackage
    ? (c.status === "over" ? "var(--status-over)" : c.status === "under" ? "var(--status-warn)" : "var(--status-ok)")
    : undefined;
  const statusText = isPackage && c.status !== "no-pkg"
    ? (c.status === "over" ? `${fmt(Math.abs(c.newBalance))} h over-served` : c.status === "under" ? `${fmt(Math.abs(c.newBalance))} h under-served` : "on track")
    : null;

  const worked = c.workedFiltered ?? c.worked;
  const pkg = c.pkg ?? 0;
  const carry = Math.abs(c.priorBalance ?? 0);
  const effective = pkg - (c.priorBalance ?? 0);
  const barMax = Math.max(worked, effective, pkg, 1) * 1.15;
  const workedPct = Math.max(0, Math.min(100, (worked / barMax) * 100));
  const pkgPct = (pkg / barMax) * 100;

  // priorBalance < 0: unused hours banked last month, brought into this one — a
  // benefit, shown green. priorBalance > 0: the client over-used their package
  // last month, so this month's hours are effectively paying that down — shown
  // red, same "carried in (green) vs. carried over/used (red)" convention the
  // drawer already uses for this exact field, just applied to this row too.
  const carryLabel = c.priorBalance == null || c.priorBalance === 0 ? "Carry-over"
    : c.priorBalance < 0 ? "Carried in" : "Over-used prior";
  const carryTone = c.priorBalance == null || c.priorBalance === 0 ? undefined
    : c.priorBalance < 0 ? "var(--status-ok)" : "var(--status-over)";
  const carryTitle = c.priorBalance == null ? undefined
    : c.priorBalance < 0 ? `${fmt(carry)} h of unused package time carried in from last month.`
    : c.priorBalance > 0 ? `${fmt(carry)} h of last month's over-use being carried over into this month.`
    : undefined;
  // remaining < 0: over-served (used more than the package this month) — red.
  // remaining > 0: hours still left in the package this month — green.
  const remainingTone = c.remaining == null || c.remaining === 0 ? undefined
    : c.remaining < 0 ? "var(--status-over)" : "var(--status-ok)";

  // A friendlier status pill (On pace / At risk / Overserviced / No package) for
  // package-style clients, reusing the same over/under/ok tone already computed
  // above; non-package clients just get their type as a neutral pill.
  // Status column reflects package pacing (the only type with an over/under/on-pace
  // concept) -- non-package types (hourly, quoted, ad hoc, …) have no such notion, and
  // showing their type here again would just repeat the Type column two cells over,
  // so they get a plain "not tracked" placeholder instead.
  const statusPill = isPackage
    ? (c.pkg == null
      ? { label: "No package", tone: "var(--fg-tertiary)", bg: "var(--bg-elevated)" }
      : c.status === "over"
        ? { label: "Overserviced", tone: "var(--status-over)", bg: "var(--status-over-soft)" }
        : c.status === "under"
          ? { label: "At risk", tone: "var(--status-warn)", bg: "var(--status-warn-soft)" }
          : { label: "On pace", tone: "var(--status-ok)", bg: "var(--status-ok-soft)" })
    : null;

  const consultantEntries = [...c.userMinutes.entries()].sort((a, b) => b[1] - a[1]);
  const consultantTotal = consultantEntries.reduce((a, [, min]) => a + min, 0);
  const shownConsultants = consultantsAllShown ? consultantEntries : consultantEntries.slice(0, 3);
  const taskEntries = [...c.tasksFiltered.entries()].sort((a, b) => b[1] - a[1]);
  const shownTasks = tasksAllShown ? taskEntries : taskEntries.slice(0, 3);

  return (
    <div className={"pg-row-wrap" + (nested ? " pg-row--nested" : "")}>
      <div
        role="button" tabIndex={0}
        className={"pg-row pg-row-grid-cols" + (active ? " pg-row--active" : "") + (inlineOpen ? " pg-row--expanded" : "")}
        onClick={onOpen}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      >
        <span className="pg-row__index">{!nested ? index : null}</span>
        <ClientAvatar name={c.displayName} logo={c.logoUrl} size={32} style={{ marginRight: -6 }} />
        <span className="pg-row__name">
          <span className="pg-row__name-main">
            {c.displayName}
            {c.isOffboarded && <span className="pg-tag pg-tag--muted pg-tag--pill" style={{ marginLeft: 6 }} title={c.offboardNote}>Offboarded</span>}
          </span>
          {c.costCentre ? (
            <button
              type="button"
              aria-label={costCentreOpen ? "Collapse cost centre breakdown" : "Expand cost centre breakdown"}
              className="pg-row__name-sub pg-row__name-sub--toggle"
              onClick={(e) => { e.stopPropagation(); setCostCentreOpen((o) => !o); }}
            >
              Rolled Up <ChevronDown size={12} style={{ transform: costCentreOpen ? "rotate(180deg)" : undefined }} />
            </button>
          ) : (
            <span className="pg-row__name-sub">
              {nested ? <><Link2 size={10} /> Sub project</>
                : (c.capGroup && c.capGroup !== c.displayName ? c.capGroup : null)}
            </span>
          )}
        </span>
        <span className="pg-tag pg-tag--pill" style={{ color: CLIENT_TYPE_TONES[c.type] }}>{TYPE_LABELS_SHORT[c.type]}</span>
        <span className="pg-row__num" style={carryTone ? { color: carryTone } : undefined} title={carryTitle}>
          <span className="pg-row__num-label">{carryLabel}</span>{c.priorBalance != null ? `${fmt(carry)} h` : "—"}
        </span>
        <span className="pg-row__num">
          <span className="pg-row__num-label">Package</span>{c.pkg != null ? `${fmt(c.pkg)} h` : "—"}
        </span>
        <span className="pg-row__num">
          <span className="pg-row__num-label">Worked</span>{fmt(worked)} h
        </span>
        <span className="pg-row__num" style={remainingTone ? { color: remainingTone } : undefined}>
          <span className="pg-row__num-label">Remaining</span>
          {c.remaining != null ? `${c.remaining < 0 ? "−" : ""}${fmt(Math.abs(c.remaining))} h` : "—"}
        </span>
        <span className="pg-row__status">
          {statusPill && (
            <span className="pg-status-pill" style={{ color: statusPill.tone, background: statusPill.bg }} title={statusText || undefined}>
              {statusPill.label}
            </span>
          )}
        </span>
        <span className="pg-row__menu" style={{ position: "relative" }} ref={menuRef}>
          <button
            type="button" aria-label="More actions"
            className="pg-row__chevron pg-icon-btn-sm"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
          >
            <MoreVertical size={16} />
          </button>
          {menuOpen && (
            <div className="pg-menu" onClick={(e) => e.stopPropagation()}>
              <ExportItem icon={<Users size={14} />} label="Open full details" onClick={() => { setMenuOpen(false); onOpen(); }} />
              <ExportItem
                icon={<ChevronDown size={14} style={{ transform: inlineOpen ? "rotate(180deg)" : undefined }} />}
                label={inlineOpen ? "Hide reconciliation breakdown" : "Show reconciliation breakdown"}
                onClick={() => { setMenuOpen(false); setInlineOpen((o) => !o); }}
              />
              <div className="pg-menu-sep" />
              <ExportItem icon={<Copy size={14} />} label="Copy summary" onClick={() => { setMenuOpen(false); onCopy?.(c); }} />
              <ExportItem icon={<Printer size={14} />} label="Generate PDF" onClick={() => { setMenuOpen(false); onPdf?.(c); }} />
            </div>
          )}
        </span>
      </div>

      {c.costCentre && costCentreOpen && <CostCentreBreakdown client={c} />}

      {inlineOpen && (
        <div className="pg-row-inline">
          <div className="pg-row-inline__col">
            <div className="pg-row-inline__title">Reconciliation overview</div>
            {isPackage && c.pkg != null ? (
              <>
                <div className="pg-row-inline__barhead">
                  <span>worked {fmt(worked)} h</span>
                  {c.remaining != null && (
                    <span style={{ color: statusTone }}>{c.remaining < 0 ? "over" : "under"} {fmt(Math.abs(c.remaining))} h</span>
                  )}
                </div>
                <div className="pg-bar-track" style={{ marginTop: 6 }}>
                  <div className="pg-bar-fill" style={{ width: `${workedPct}%`, background: statusTone || "var(--status-ok)" }} />
                  <div className="pg-bar-mark" style={{ left: `${pkgPct}%` }} />
                </div>
                <div className="pg-bar-caption" style={{ marginTop: 6 }}>
                  <span>package {fmt(pkg)} h</span>
                  <span>carry-over {fmt(carry)} h</span>
                </div>
              </>
            ) : (
              <div className="pg-row-inline__empty">No package on file for this client.</div>
            )}
          </div>

          <div className="pg-row-inline__col">
            <div className="pg-row-inline__title">Consultants involved</div>
            {consultantEntries.length === 0 && <div className="pg-row-inline__empty">No consultants logged.</div>}
            {shownConsultants.map(([u, min]) => (
              <div key={u || "unknown"} className="pg-row-inline__line">
                <span>{u || "—"}</span>
                <span className="pg-row-inline__line-num">{fmt(min / 60)} h · {consultantTotal > 0 ? Math.round((min / consultantTotal) * 100) : 0}%</span>
              </div>
            ))}
            {consultantEntries.length > 3 && (
              <button className="pg-row-inline__more" onClick={() => setConsultantsAllShown((o) => !o)}>
                {consultantsAllShown ? "Show fewer" : `View all ${consultantEntries.length} consultants`}
              </button>
            )}
          </div>

          <div className="pg-row-inline__col">
            <div className="pg-row-inline__title">Tasks worked {tasksAllShown ? "" : "(top 3)"}</div>
            {taskEntries.length === 0 && <div className="pg-row-inline__empty">No tasks in this filter.</div>}
            {shownTasks.map(([task, min]) => (
              <div key={task} className="pg-row-inline__line">
                <span className="pg-row-inline__task">{task}</span>
                <span className="pg-row-inline__line-num">{fmt(min / 60)} h</span>
              </div>
            ))}
            {taskEntries.length > 3 && (
              <button className="pg-row-inline__more" onClick={() => setTasksAllShown((o) => !o)}>
                {tasksAllShown ? "Show fewer" : `View all ${taskEntries.length} tasks`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
