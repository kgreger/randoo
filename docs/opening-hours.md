# Opening hours

The list and the map show a point's opening hours as a 7-day chart instead of OpenStreetMap's own syntax. Nothing is evaluated: the app says when a place is open on a normal week, not whether it is open now.

## Where the parsing happens

Only in the weekly data build of the private `randoo-infra` repository (`randoo_infra/pipeline/hours.py`, see its README). Every distinct `opening_hours` value is parsed once and the result is stored on the POI rows of `pois.parquet` as `opening_hours_norm`, `hours_week` and `hours_source`. This backend never parses hours and nothing is computed per request.

`LocalPoiSource` reads `hours_week` when the file has the column and `PoiOut.hours_week` passes it through untouched. A file built before the column existed, and every Overpass result (the free tier), have none. A stored week the backend cannot read (not JSON, not seven days) is dropped for that point, the raw text is still sent.

## The week

```json
{"v": 1, "ws": "2026-11-23",
 "days": [[{"s": 540, "e": 1080}], [], [], [], [], [], []],
 "ph": null,
 "seasonal": true}
```

- `days` runs Monday to Sunday. A segment is a stretch of that day in minutes since midnight; `e` is 1440 at the day's end. A range past midnight is split over the two days.
- Optional per segment: `c` the value's own comment (`"nach Vereinbarung"`), `u` the state is unknown rather than open, `oe` an open end such as `11:00+` (open from `s`, no known closing time; `e` is only where the day ends).
- `ph` is only what the value itself says about a public holiday: `null` nothing, `[]` closed, or the segments of its own hours. It never says which day is a holiday and nothing is looked up for the point's location.
- `seasonal` is set when the value depends on month, week or date. One week cannot describe the year then, so the chart shows the week the data was built for (`ws`) and says so.

## In the interface

- List: a card shows only a small "Opening hours" chip when the point has a value (the raw text is mostly cut off there anyway). Clicking it opens a popover (`HoursPopover` in `PoiList.tsx`). A point of a category that usually has hours but no value shows "Opening hours unknown" instead.
- Map: the popup of a point carries the same panel. Its content is built lazily when the popup opens (`bindPopup` with a function). `App.tsx` memoises the `pois` and `waypoints` arrays it hands to `MapView`; the markers are rebuilt whenever those change, and a new array on every render closed the popup right after a marker click.
- Both are built by `lib/hoursChart.ts` from DOM nodes with all text set as text, since the value and its comments come from OpenStreetMap. The chart takes its colours from the surrounding text colour, so it reads on the dark popover and the light map popup.
- Bars are minute-exact on a 0 to 24 h axis with a line per hour. The times stand next to each bar, an open end reads "ab 11:00" and fades out, an unknown state is hatched.
- Where there is no parsed week (free tier, a value the build could not parse, a saved plan from before this existed) the popover shows only the value as mapped, wrapped. The text is always shown below the chart too, labelled as unchecked.

## Not done yet

- Open now / open today, and arrival times along the route (the build stores the normalised string for that).
- Values the parser rejects and the format repairs cannot fix are shown as raw text. A later step may translate them with a language model, reviewed against a table of exceptions.
- A saved plan keeps the week it was built with. `ws` says which week that was.
