import { useId } from "react";

// Small inline SVG sparkline for a stat card. Smooths the line with a light
// Catmull-Rom-derived Bezier so short series (as few as 2 points) don't look jagged.
export default function MiniSparkline({
  data = [],
  width = 120,
  height = 36,
  color = "var(--accent)",
  strokeWidth = 2,
  ariaLabel = "Trend",
  className = "",
}) {
  const rawId = useId().replace(/:/g, "");
  const gradientId = `spark-grad-${rawId}`;

  if (!Array.isArray(data) || data.length < 2) return null;

  const pad = strokeWidth + 1;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => ({
    x: pad + (i / (data.length - 1)) * (width - pad * 2),
    y: pad + ((max - v) / range) * (height - pad * 2),
  }));

  const linePath = points.reduce((path, point, i) => {
    if (i === 0) return `M ${point.x} ${point.y}`;
    const prev = points[i - 1];
    const prevPrev = points[i - 2] ?? prev;
    const next = points[i + 1] ?? point;
    const c1x = prev.x + (point.x - prevPrev.x) / 6;
    const c1y = prev.y + (point.y - prevPrev.y) / 6;
    const c2x = point.x - (next.x - prev.x) / 6;
    const c2y = point.y - (next.y - prev.y) / 6;
    return `${path} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${point.x} ${point.y}`;
  }, "");

  const baseline = height - pad;
  const last = points[points.length - 1];
  const areaPath = `${linePath} L ${last.x} ${baseline} L ${points[0].x} ${baseline} Z`;

  return (
    <svg
      className={`pg-sparkline ${className}`.trim()}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="70%" stopColor={color} stopOpacity="0.05" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last.x} cy={last.y} r={strokeWidth + 1} fill={color} />
    </svg>
  );
}
