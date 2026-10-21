// Matches the breakpoint in styles.css where the map and the POI list stack
// into one scrolling page instead of sitting side by side.
export function isStackedLayout(): boolean {
  return window.matchMedia("(max-width: 900px)").matches;
}
