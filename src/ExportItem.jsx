import React from "react";

// One row in any of the app's dropdown menus (export menu, row/drawer "more
// actions" menus, the command-search results list) -- icon + label + click
// handler, optionally disabled with an explanatory title. Shared so every
// menu in the app renders its items identically.
export function ExportItem({ icon, label, onClick, disabled, title }) {
  return (
    <button onClick={onClick} className="pg-menu-item" disabled={disabled} title={title}>
      {icon}
      {label}
    </button>
  );
}
