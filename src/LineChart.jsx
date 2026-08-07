import React, { useState, useRef } from "react";

function monthLabelShort(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "short", year: "2-digit" });
}

/* ============================================================
   LINE CHART (SVG) — restyled to the Purple Giraffe palette; same
   shape as Capacity Planning's data, just plotted over time.
============================================================ */
export function LineChart({ series, months }) {
  const W = 640, H = 280, padL = 40, padR = 16, padT = 16, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const allVals = series.flatMap((s) => s.points.filter((v) => v !== null && v !== undefined));
  const maxV = allVals.length ? Math.max(...allVals) * 1.15 : 10;
  const x = (i) => (months.length <= 1 ? padL + plotW / 2 : padL + (i / (months.length - 1)) * plotW);
  const y = (v) => padT + plotH - (maxV ? (v / maxV) * plotH : 0);
  const [hoverIdx, setHoverIdx] = useState(null);
  const svgRef = useRef(null);

  if (months.length === 0) {
    return <div className="pg-empty">No months of ClickUp data to chart yet.</div>;
  }

  function handleMove(e) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    let nearest = 0, best = Infinity;
    months.forEach((_, i) => { const d = Math.abs(x(i) - relX); if (d < best) { best = d; nearest = i; } });
    setHoverIdx(nearest);
  }

  return (
    <div className="pg-linechart" style={{ position: "relative" }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" onMouseMove={handleMove} onMouseLeave={() => setHoverIdx(null)}>
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
        {series.map((s, si) => {
          const pts = s.points.map((v, i) => (v === null || v === undefined ? null : [x(i), y(v)]));
          const segments = [];
          let cur = [];
          pts.forEach((p) => { if (p === null) { if (cur.length) segments.push(cur); cur = []; } else cur.push(p); });
          if (cur.length) segments.push(cur);
          return (
            <g key={si}>
              {segments.map((seg, gi) => (
                <path key={gi} d={seg.map((p, i) => (i === 0 ? "M" : "L") + p[0] + "," + p[1]).join(" ")} fill="none" stroke={s.color} strokeWidth="2.25" />
              ))}
              {pts.map((p, i) => (p ? <circle key={i} cx={p[0]} cy={p[1]} r={hoverIdx === i ? 4 : 2.75} fill={s.color} /> : null))}
            </g>
          );
        })}
        {months.map((m, i) => (
          <text key={m} x={x(i)} y={H - 8} fill="var(--fg-tertiary)" fontSize="10" textAnchor="middle" fontFamily="var(--font-mono)">{monthLabelShort(m)}</text>
        ))}
        {hoverIdx !== null && (
          <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={padT} y2={padT + plotH} stroke="var(--accent)" strokeWidth="1" strokeDasharray="3,3" opacity="0.5" />
        )}
      </svg>
      {hoverIdx !== null && (
        <div style={{
          position: "absolute", left: `${(x(hoverIdx) / W) * 100}%`, top: 4, transform: "translateX(-50%)",
          background: "var(--bg-card)", border: "1px solid var(--border-soft)", borderRadius: "var(--app-radius-sm)",
          padding: "7px 10px", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-primary)",
          pointerEvents: "none", whiteSpace: "nowrap", zIndex: 5, boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
        }}>
          <div style={{ color: "var(--fg-tertiary)", marginBottom: 4 }}>{monthLabelShort(months[hoverIdx])}</div>
          {series.map((s) => {
            const v = s.points[hoverIdx];
            if (v === null || v === undefined) return null;
            return (
              <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <i style={{ width: 8, height: 8, borderRadius: "50%", display: "inline-block", background: s.color }} />
                {s.label}: <b>{v.toFixed(1)}</b>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
