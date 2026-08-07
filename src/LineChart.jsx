import React, { useState } from "react";
import { useDismissable } from "./useDismissable.js";

function monthLabelShort(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "short", year: "2-digit" });
}

// A neutral/reference line (a target, a total-across-types line) stays grey so it
// reads as "backdrop" rather than competing with the real data series for attention.
const NEUTRAL_LABELS = new Set(["Agreed", "Total Agreed", "Total Timelog"]);
// Chosen for max pairwise distinction at a glance -- CLIENT_TYPE_TONES (reused
// elsewhere for badges) has several types sharing the same accent/orchid hue,
// which is exactly what made this chart hard to read with more than 2-3 lines.
const PALETTE = [
  "#8B5CF6", // purple
  "#EF4444", // red
  "#22C55E", // green
  "#3B82F6", // blue
  "#F97316", // orange
  "#14B8A6", // teal
  "#EC4899", // pink
  "#EAB308", // amber
  "#06B6D4", // cyan
];
function resolveColors(series) {
  let vivid = 0;
  return series.map((s) => (NEUTRAL_LABELS.has(s.label) ? "var(--fg-tertiary)" : PALETTE[vivid++ % PALETTE.length]));
}

/* ============================================================
   LINE CHART (SVG) — Purple Giraffe palette, plus its own legend so
   color assignment has exactly one source of truth (chart + legend
   markers can never drift onto different colors for the same series).

   Interaction:
   - Hover a node (circle): tooltip for just that series' value.
   - Hover a month's axis label: tooltip for every series that month
     (the old whole-chart behavior), plus a guide line.
   - Click a legend entry: isolate that line, hiding the rest. Click it
     again, or click anywhere outside the chart, to show all lines again.
============================================================ */
export function LineChart({ series, months }) {
  const W = 640, H = 280, padL = 40, padR = 16, padT = 16, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const [activeLabel, setActiveLabel] = useState(null); // legend isolation; null = show all
  const [hoverMonthIdx, setHoverMonthIdx] = useState(null); // month-label hover -> full tooltip
  const [hoverPoint, setHoverPoint] = useState(null); // { si, i } node hover -> single-value tooltip
  const containerRef = useDismissable(() => setActiveLabel(null));

  const colors = resolveColors(series);
  const visible = activeLabel ? series.filter((s) => s.label === activeLabel) : series;
  const visibleColors = activeLabel ? [colors[series.findIndex((s) => s.label === activeLabel)]] : colors;

  const allVals = visible.flatMap((s) => s.points.filter((v) => v !== null && v !== undefined));
  const maxV = allVals.length ? Math.max(...allVals) * 1.15 : 10;
  const x = (i) => (months.length <= 1 ? padL + plotW / 2 : padL + (i / (months.length - 1)) * plotW);
  const y = (v) => padT + plotH - (maxV ? (v / maxV) * plotH : 0);

  const toggleLegend = (label) => setActiveLabel((cur) => (cur === label ? null : label));

  const legend = (
    <div style={{ display: "flex", gap: 16, marginBottom: 8, flexWrap: "wrap" }}>
      {series.map((s, si) => {
        const isDimmed = activeLabel && activeLabel !== s.label;
        return (
          <button
            key={s.label}
            type="button"
            onClick={() => toggleLegend(s.label)}
            style={{
              display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--font-mono)", fontSize: 10.5,
              color: isDimmed ? "var(--fg-tertiary)" : "var(--fg-secondary)", opacity: isDimmed ? 0.5 : 1,
              background: "none", border: "none", padding: 0, cursor: "pointer",
            }}
            aria-pressed={activeLabel === s.label}
            title={activeLabel === s.label ? `Showing only ${s.label} — click to show all` : `Show only ${s.label}`}
          >
            <i style={{ width: 14, height: 3, borderRadius: 2, display: "inline-block", background: colors[si] }} />
            {s.label}
          </button>
        );
      })}
    </div>
  );

  if (months.length === 0) {
    return (
      <div ref={containerRef}>
        {legend}
        <div className="pg-empty">No months of ClickUp data to chart yet.</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="pg-linechart" style={{ position: "relative" }}>
      {legend}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const v = maxV * f;
          const gy = y(v);
          return (
            <g key={f}>
              <line x1={padL} x2={W - padR} y1={gy} y2={gy} stroke="var(--border-soft)" strokeWidth="1" />
              <text x={2} y={gy + 4} fill="var(--fg-tertiary)" fontSize="9" fontFamily="var(--font-mono)">{v.toFixed(0)}</text>
            </g>
          );
        })}
        {visible.map((s, vi) => {
          const si = series.indexOf(s);
          const color = visibleColors[vi];
          const pts = s.points.map((v, i) => (v === null || v === undefined ? null : [x(i), y(v)]));
          const segments = [];
          let cur = [];
          pts.forEach((p) => { if (p === null) { if (cur.length) segments.push(cur); cur = []; } else cur.push(p); });
          if (cur.length) segments.push(cur);
          return (
            <g key={s.label}>
              {segments.map((seg, gi) => (
                <path key={gi} d={seg.map((p, i) => (i === 0 ? "M" : "L") + p[0] + "," + p[1]).join(" ")} fill="none" stroke={color} strokeWidth="2.25" />
              ))}
              {pts.map((p, i) => {
                if (!p) return null;
                const isHovered = hoverMonthIdx === i || (hoverPoint && hoverPoint.si === si && hoverPoint.i === i);
                return (
                  <circle
                    key={i} cx={p[0]} cy={p[1]} r={isHovered ? 4 : 2.75} fill={color}
                    style={{ cursor: "pointer" }}
                    onMouseEnter={() => setHoverPoint({ si, i })}
                    onMouseLeave={() => setHoverPoint((cur2) => (cur2 && cur2.si === si && cur2.i === i ? null : cur2))}
                  />
                );
              })}
            </g>
          );
        })}
        {months.map((m, i) => (
          <text
            key={m} x={x(i)} y={H - 8} fill="var(--fg-tertiary)" fontSize="10" textAnchor="middle" fontFamily="var(--font-mono)"
            style={{ cursor: "pointer" }}
            onMouseEnter={() => setHoverMonthIdx(i)}
            onMouseLeave={() => setHoverMonthIdx((cur2) => (cur2 === i ? null : cur2))}
          >
            {monthLabelShort(m)}
          </text>
        ))}
        {hoverMonthIdx !== null && (
          <line x1={x(hoverMonthIdx)} x2={x(hoverMonthIdx)} y1={padT} y2={padT + plotH} stroke="var(--accent)" strokeWidth="1" strokeDasharray="3,3" opacity="0.5" />
        )}
      </svg>

      {hoverMonthIdx !== null && (
        <div style={{
          position: "absolute", left: `${(x(hoverMonthIdx) / W) * 100}%`, top: 4, transform: "translateX(-50%)",
          background: "var(--bg-card)", border: "1px solid var(--border-soft)", borderRadius: "var(--app-radius-sm)",
          padding: "7px 10px", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-primary)",
          pointerEvents: "none", whiteSpace: "nowrap", zIndex: 5, boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
        }}>
          <div style={{ color: "var(--fg-tertiary)", marginBottom: 4 }}>{monthLabelShort(months[hoverMonthIdx])}</div>
          {visible.map((s, vi) => {
            const v = s.points[hoverMonthIdx];
            if (v === null || v === undefined) return null;
            return (
              <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <i style={{ width: 8, height: 8, borderRadius: "50%", display: "inline-block", background: visibleColors[vi] }} />
                {s.label}: <b>{v.toFixed(1)}</b>
              </div>
            );
          })}
        </div>
      )}

      {hoverPoint && hoverMonthIdx === null && (() => {
        const s = series[hoverPoint.si];
        const v = s.points[hoverPoint.i];
        if (v === null || v === undefined) return null;
        return (
          <div style={{
            position: "absolute", left: `${(x(hoverPoint.i) / W) * 100}%`, top: 4, transform: "translateX(-50%)",
            background: "var(--bg-card)", border: "1px solid var(--border-soft)", borderRadius: "var(--app-radius-sm)",
            padding: "7px 10px", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-primary)",
            pointerEvents: "none", whiteSpace: "nowrap", zIndex: 5, boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <i style={{ width: 8, height: 8, borderRadius: "50%", display: "inline-block", background: colors[hoverPoint.si] }} />
              {s.label}: <b>{v.toFixed(1)}</b>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
