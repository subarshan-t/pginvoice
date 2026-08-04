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
