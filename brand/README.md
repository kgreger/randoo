# Brand assets

Logo, favicon and app icons for Randoo.

## License

The Randoo name and the logo files in this directory are not covered by the AGPL-3.0 license that applies to the rest of this repository. All rights reserved.

## Files

| File | Use |
| --- | --- |
| `randoo-logo.svg` | Symbol and wordmark in colour, for dark backgrounds |
| `randoo-logo-dark.svg` | One colour (`#241a30`), for light backgrounds |
| `randoo-logo-light.svg` | One colour (`#f7f1ef`), for dark backgrounds when colour isn't possible |
| `randoo-symbol.svg`, `-dark.svg`, `-light.svg` | Symbol only, same three treatments |
| `favicon.svg`, `favicon.ico` | Browser tab icon: rounded tile, heavy rings, no route |
| `app-icon.svg` | Full-bleed square tile for touch and PWA icons |
| `og-image.svg` | Social preview image |
| `png/` | Raster exports: favicons (16, 32, 48), `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`, `randoo-symbol-512.png`, `randoo-logo-1200.png`, `og-image.png` (1200 x 630) |

The route dots in the colour symbol and logo are light, so those files only work on dark backgrounds. Use the `-dark` variants on light ones.

## Colours

| Name | Value |
| --- | --- |
| Background | `#0e0c18` |
| Ink | `#f7f1ef` |
| Coral (start) | `#ff8f6b` |
| Amber (destination) | `#ffbd6b` |
| Ink on tile | `#241a30` |

The tile gradient runs from coral to amber at 135 degrees.

## Typography

The wordmark is set in Outfit SemiBold (600) with -0.3 letter spacing at 36 px, converted to outlines, so the SVG files don't need the font. Outfit is licensed under the SIL Open Font License 1.1.

## Construction

The symbol is drawn on a 64 x 64 grid. Both rings have radius 8 and stroke 4.5. The route is seven separate circles, point-symmetric around (32, 32.5): three small dots on each side of the larger middle dot, with the outer two sitting at the same distance from their rings. The favicon uses heavier rings (radius 8.5, stroke 6.5) and leaves out the route, because the dotted line doesn't survive at 16 px.
