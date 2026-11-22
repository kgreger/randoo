import type { TFunction } from "i18next";
import type { HoursSegment, HoursWeek, Poi } from "./api";

// The opening-hours panel shown in the list's popover and in the map popup:
// a 7-day chart (bars from midnight to midnight, hourly grid, the times as
// text beside them), one line for public holidays, and the value as mapped.
//
// Built from DOM nodes with every text set as text, never as HTML: the raw
// value and its comments come from OpenStreetMap. A plain function rather than
// a React component because Leaflet popups take DOM nodes; the list wraps the
// same function so both show exactly the same thing.

const DAY_KEYS = ["mo", "tu", "we", "th", "fr", "sa", "su"] as const;
const DAY_MINUTES = 1440;
const AXIS_HOURS = [0, 6, 12, 18, 24];

export function formatMinute(minute: number): string {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Only segments that make sense on a day, clamped to it. The week comes from
 * our own data build, but a malformed one must not break the page. */
function cleanSegments(segments: unknown): HoursSegment[] {
  if (!Array.isArray(segments)) return [];
  const clean: HoursSegment[] = [];
  for (const segment of segments) {
    if (!segment || !Number.isFinite(segment.s) || !Number.isFinite(segment.e)) continue;
    const s = Math.max(0, Math.min(DAY_MINUTES, segment.s));
    const e = Math.max(0, Math.min(DAY_MINUTES, segment.e));
    if (e > s) clean.push({ ...segment, s, e });
  }
  return clean.sort((a, b) => a.s - b.s);
}

/** One segment as text: "09:00–18:00", "ab 11:00" for an open end (the end of
 * the bar is only where the day ends), with the value's own comment. */
export function segmentText(segment: HoursSegment, t: TFunction): string {
  let text = segment.oe
    ? t("hours.openFrom", { time: formatMinute(segment.s) })
    : `${formatMinute(segment.s)}–${formatMinute(segment.e)}`;
  if (segment.u) text += ` (${t("hours.unclear")})`;
  if (segment.c) text += ` – ${segment.c}`;
  return text;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function track(segments: HoursSegment[]): HTMLElement {
  const bar = el("div", "hours-track");
  bar.setAttribute("aria-hidden", "true");
  for (const segment of segments) {
    const part = el("div", "hours-seg");
    if (segment.u) part.classList.add("hours-seg-unknown");
    if (segment.oe) part.classList.add("hours-seg-open-end");
    part.style.left = `${(segment.s / DAY_MINUTES) * 100}%`;
    part.style.width = `${((segment.e - segment.s) / DAY_MINUTES) * 100}%`;
    if (segment.c) part.title = segment.c;
    bar.append(part);
  }
  return bar;
}

function axis(): HTMLElement[] {
  const labels = el("div", "hours-axis");
  labels.setAttribute("aria-hidden", "true");
  for (const hour of AXIS_HOURS) {
    const label = el("span", undefined, String(hour));
    label.style.left = `${(hour / 24) * 100}%`;
    labels.append(label);
  }
  return [el("span"), labels, el("span")];
}

function dayRow(label: string, segments: HoursSegment[], t: TFunction, labelTitle?: string): HTMLElement {
  const row = el("div", "hours-row");
  const text = segments.length ? segments.map((s) => segmentText(s, t)).join(", ") : t("hours.closed");
  const times = el("span", segments.length ? "hours-times" : "hours-times hours-none", text);
  const day = el("span", "hours-day", label);
  if (labelTitle) day.title = labelTitle;
  row.append(day, track(segments), times);
  return row;
}

/** Public holidays, as far as the value itself says anything: nothing, closed,
 * or hours of its own. Never which day that would be. */
function holidayRow(ph: HoursSegment[] | null | undefined, t: TFunction): HTMLElement {
  const segments = ph == null ? null : cleanSegments(ph);
  if (segments === null || segments.length === 0) {
    const row = el("div", "hours-row");
    const label = el("span", "hours-day", t("hours.holiday"));
    label.title = t("hours.holidayHint");
    const note = el("span", "hours-none hours-holiday-note", segments === null ? t("hours.noHolidayInfo") : t("hours.closed"));
    row.append(label, note);
    return row;
  }
  return dayRow(t("hours.holiday"), segments, t, t("hours.holidayHint"));
}

function seasonalNote(week: HoursWeek, t: TFunction, language: string): HTMLElement {
  let date = week.ws;
  try {
    date = new Intl.DateTimeFormat(language, { day: "numeric", month: "numeric" }).format(new Date(`${week.ws}T00:00:00`));
  } catch {
    // keep the ISO date
  }
  const note = el("div", "hours-seasonal");
  note.append(el("span", "hours-badge", t("hours.seasonal")), el("span", undefined, t("hours.seasonalHint", { date })));
  return note;
}

/** True for a week this code can draw. */
export function usableWeek(week: HoursWeek | null | undefined): week is HoursWeek {
  return !!week && Array.isArray(week.days) && week.days.length === 7;
}

export function buildHoursChart(week: HoursWeek, t: TFunction, language: string): HTMLElement {
  const wrap = el("div", "hours-chart-wrap");
  const chart = el("div", "hours-chart");
  chart.setAttribute("role", "group");
  chart.setAttribute("aria-label", t("hours.title"));
  chart.append(...axis());
  week.days.forEach((segments, i) => chart.append(dayRow(t(`hours.days.${DAY_KEYS[i]}`), cleanSegments(segments), t)));
  chart.append(el("div", "hours-sep"), holidayRow(week.ph, t));
  wrap.append(chart);
  if (week.seasonal) wrap.append(seasonalNote(week, t, language));
  return wrap;
}

/** What to show for a point's opening hours: the chart when the data build
 * parsed them, and the value as mapped (wrapped, so a long one stays readable).
 * Null when there is nothing to show. */
export function buildHoursPanel(
  poi: Pick<Poi, "opening_hours" | "hours_week">,
  t: TFunction,
  language: string,
): HTMLElement | null {
  const week = usableWeek(poi.hours_week) ? poi.hours_week : null;
  const raw = poi.opening_hours?.trim();
  if (!week && !raw) return null;
  const panel = el("div", "hours-panel");
  if (week) panel.append(buildHoursChart(week, t, language));
  if (raw) {
    const block = el("div", "hours-raw");
    block.append(el("span", "hours-raw-label", t("hours.rawLabel")), el("span", "hours-raw-text", raw));
    panel.append(block);
  }
  return panel;
}
