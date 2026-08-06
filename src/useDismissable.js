import { useEffect, useRef } from "react";

// Shared outside-click + Escape dismissal for dropdowns/menus/popovers. Attach the
// returned ref to the dismissable container (the thing that should NOT trigger a
// dismiss when clicked inside it). Pass `extraRef` for a second element that should
// also be excluded from the outside-click check (e.g. the trigger button that lives
// outside the menu's own DOM subtree). Pass `onReposition` for menus that also need
// to re-measure/reposition on scroll or resize while open.
export function useDismissable(onDismiss, { extraRef = null, onReposition = null } = {}) {
  const ref = useRef(null);
  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        if (extraRef && extraRef.current && extraRef.current.contains(e.target)) return;
        onDismiss();
      }
    };
    const onKey = (e) => { if (e.key === "Escape") onDismiss(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    let onScroll, onResize;
    if (onReposition) {
      onScroll = () => onReposition();
      onResize = () => onReposition();
      window.addEventListener("scroll", onScroll, true);
      window.addEventListener("resize", onResize);
    }
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      if (onReposition) {
        window.removeEventListener("scroll", onScroll, true);
        window.removeEventListener("resize", onResize);
      }
    };
  }, [onDismiss, extraRef, onReposition]);
  return ref;
}

// Escape-only dismissal for cases with no outside-click container (e.g. a full-screen
// drawer where any outside click doesn't apply).
export function useEscape(onDismiss) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onDismiss(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);
}
