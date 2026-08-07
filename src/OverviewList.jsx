import React from "react";

// A titled card wrapping a short ranked list (name + numeric badge + tone) —
// used for the over-utilized-consultants list and the negative-balance-
// clients list. `emptyMessage` renders instead of the list when `items` is
// empty, so an empty list reads as good news ("No consultants currently
// over-utilized") rather than a blank/broken-looking card.
export function OverviewList({ title, items, emptyMessage, renderBadge, index }) {
  return (
    <div className="ov-card ov-list" style={{ ["--i"]: index ?? 0 }}>
      <div className="ov-list__title">{title}</div>
      {(!items || items.length === 0) ? (
        <div className="ov-list__empty">{emptyMessage}</div>
      ) : (
        <ul className="ov-list__items">
          {items.map((item, i) => (
            <li key={item.key ?? item.name ?? i} className="ov-list__item">
              <span className="ov-list__item-rank">{i + 1}</span>
              <span className="ov-list__item-name">{item.name}</span>
              <span className="ov-list__item-badge" style={item.tone ? { color: item.tone } : undefined}>
                {renderBadge ? renderBadge(item) : item.badge}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
