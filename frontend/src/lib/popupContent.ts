/** What a map popup shows. Everything that can come from OpenStreetMap or from
 * an uploaded GPX file (names, descriptions) is set as text and never parsed
 * as HTML. */
export interface PopupOptions {
  title: string;
  /** Under the title: what kind of point this is. */
  subtitle?: string | null;
  /** The type's icon as SVG markup. Only for markup from our own icon set, it
   * is the one value here that is parsed as HTML. */
  iconSvg?: string | null;
  /** Short facts below the heading (distance to the route, km on it). */
  facts?: string[];
  /** Small notes like the ones on a list card ("unchecked", "fee"). */
  badges?: { label: string; className?: string }[];
  /** Free text, such as the description a GPX waypoint came with. */
  description?: string | null;
  /** A block under a rule with its own small heading (the opening hours). */
  section?: { title: string; iconSvg?: string | null; body: HTMLElement | string; muted?: boolean } | null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconSpan(className: string, iconSvg: string): HTMLElement {
  const span = el("span", className);
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = iconSvg;
  return span;
}

export function popupContent(options: PopupOptions): HTMLElement {
  const { title, subtitle, iconSvg, facts = [], badges = [], description, section } = options;
  const root = el("div", "map-popup");

  const head = el("div", "map-popup-head");
  if (iconSvg) head.append(iconSpan("map-popup-icon", iconSvg));
  const titles = el("div", "map-popup-titles");
  titles.append(el("div", "map-popup-title", title));
  if (subtitle) titles.append(el("div", "map-popup-type", subtitle));
  head.append(titles);
  root.append(head);

  if (facts.length > 0) {
    const row = el("div", "map-popup-facts");
    for (const fact of facts) row.append(el("span", "map-popup-fact", fact));
    root.append(row);
  }

  if (badges.length > 0) {
    const row = el("div", "map-popup-badges");
    for (const badge of badges) row.append(el("span", `poi-badge ${badge.className ?? ""}`.trim(), badge.label));
    root.append(row);
  }

  if (description) root.append(el("div", "map-popup-description", description));

  if (section) {
    const block = el("div", "map-popup-section");
    const heading = el("div", "map-popup-section-title");
    if (section.iconSvg) heading.append(iconSpan("map-popup-section-icon", section.iconSvg));
    heading.append(el("span", "", section.title));
    block.append(heading);
    if (typeof section.body === "string") {
      block.append(el("div", section.muted ? "map-popup-muted" : "map-popup-text", section.body));
    } else {
      block.append(section.body);
    }
    root.append(block);
  }

  return root;
}
