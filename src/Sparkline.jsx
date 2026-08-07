// Tiny inline trend line for a KPI card — deliberately not the full LineChart
// (no axes/legend/hover, just a shape that answers "is this going up or down"
// at a glance), matching the small trend squiggle under a KPI headline number
// in dashboards like this one's reference design.
export function Sparkline({ points, color = "var(--accent)", width = 96, height = 28 }) {
  const vals = (points || []).filter((v) => v !== null && v !== undefined);
  if (vals.length < 2) return null;

  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const padY = 3;
  const x = (i) => (i / (points.length - 1)) * width;
  const y = (v) => padY + (1 - (v - min) / span) * (height - padY * 2);

  const coords = points.map((v, i) => (v === null || v === undefined ? null : [x(i), y(v)]));
  const segments = [];
  let cur = [];
  coords.forEach((p) => { if (p === null) { if (cur.length) segments.push(cur); cur = []; } else cur.push(p); });
  if (cur.length) segments.push(cur);

  const last = coords[coords.length - 1];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      {segments.map((seg, i) => (
        <path key={i} d={seg.map((p, j) => (j === 0 ? "M" : "L") + p[0] + "," + p[1]).join(" ")} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {last && <circle cx={last[0]} cy={last[1]} r="2.25" fill={color} />}
    </svg>
  );
}
