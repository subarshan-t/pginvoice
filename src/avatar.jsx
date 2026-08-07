import React from "react";

// Shrinks an uploaded photo down to a small square JPEG data URL before it's stored —
// consultant headshots get shown at ~26-40px everywhere they appear, so there's no reason
// to keep a multi-megabyte original in the shared cap_people record that every module
// reads on load.
export function resizePhotoFile(file, onDone, onErr) {
  const reader = new FileReader();
  reader.onerror = () => onErr("Couldn't read that file.");
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => onErr("That doesn't look like a valid image.");
    img.onload = () => {
      const size = 160;
      const canvas = document.createElement("canvas");
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext("2d");
      // Cover-crop to a square so different aspect ratios don't get squashed.
      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      onDone(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

// Shared circular avatar — a person's photo if they have one, otherwise their initial.
// Used in the Consultants roster, Capacity Planning's Capacity Utilization list, and
// Client Invoicing's Consultant contributions, so a photo uploaded once shows up everywhere.
export function PersonAvatar({ name, photo, size = 26, style }) {
  const initial = (name || "?").slice(0, 1).toUpperCase();
  const base = {
    flex: "none", width: size, height: size, borderRadius: "50%",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: Math.max(10, size * 0.42),
    color: "var(--fg-secondary)", background: "var(--bg-elevated)", overflow: "hidden",
    ...style,
  };
  if (photo) {
    return (
      <span style={base}>
        <img src={photo} alt={name || ""} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      </span>
    );
  }
  return <span style={base}>{initial}</span>;
}

// Fixed qualitative palette so a client's initials-avatar color stays stable across
// reloads (hashed from the name) instead of being randomly reassigned each render.
const CLIENT_AVATAR_PALETTE = [
  "#6f4af6", "#7c3aed", "#0f766e", "#b45309", "#be123c",
  "#1e3a8a", "#166534", "#9333ea", "#0369a1", "#c2410c",
];
export function colorForName(name) {
  const s = name || "";
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return CLIENT_AVATAR_PALETTE[hash % CLIENT_AVATAR_PALETTE.length];
}

// Client logo chip — an uploaded/auto-fetched logo if one's set, otherwise a
// colored circle with the client's initials (color hashed from the name, so
// it's consistent everywhere the same client shows up, same as the reference
// design's colorful client avatars).
export function ClientAvatar({ name, logo, size = 34, style }) {
  const [broken, setBroken] = React.useState(false);
  // Reset the broken flag whenever a different logo URL is handed in, so switching
  // from a failed one to a working one (or back to no logo) doesn't stay stuck.
  React.useEffect(() => { setBroken(false); }, [logo]);
  const initials = (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
  const showLogo = logo && !broken;
  const base = {
    flex: "none", width: size, height: size, borderRadius: "50%",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: Math.max(10, size * 0.36),
    color: "#fff",
    // Colored fill is purely a stand-in for a missing image -- a real logo (most
    // are transparent-background PNGs/SVGs) sits directly on the page background
    // instead, so it doesn't show through as an odd colored ring around the mark.
    background: showLogo ? "transparent" : colorForName(name),
    overflow: "hidden",
    ...style,
  };
  if (showLogo) {
    return (
      <span style={base}>
        <img
          src={logo} alt={name || ""} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          // A favicon URL can 404 (site down, no favicon) -- fall back to the initials
          // tile rather than showing a broken image icon.
          onError={() => setBroken(true)}
        />
      </span>
    );
  }
  return <span style={base}>{initials}</span>;
}
