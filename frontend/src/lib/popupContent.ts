/** The content of a map popup: a bold title and, optionally, a second line
 * and a block of already built nodes below (the opening hours). Names and
 * descriptions come from OpenStreetMap and from the uploaded GPX file, so they
 * are set as text and never parsed as HTML. */
export function popupContent(title: string, detail?: string | null, extra?: HTMLElement | null): HTMLElement {
  const root = document.createElement("div");
  const heading = document.createElement("b");
  heading.textContent = title;
  root.append(heading);
  if (detail) root.append(document.createElement("br"), detail);
  if (extra) {
    extra.classList.add("popup-extra");
    root.append(extra);
  }
  return root;
}
