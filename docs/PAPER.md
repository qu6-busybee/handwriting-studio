# Notebook paper and print accuracy

## Ruled paper measurements

| Ruling | Line spacing | Red margin from left edge | Typical lines on an 8 × 10½ in sheet |
|---|---|---|---|
| Wide (legal) ruled | 11/32 in (8.73 mm) | ~1¼ in (31.75 mm) | 27 |
| College (medium) ruled | 9/32 in (7.14 mm) | ~1¼ in (31.75 mm) | 33 |
| Narrow ruled | ¼ in (6.35 mm) | ~1¼ in (31.75 mm) | — |
| A4 feint & margin (UK/EU) | 8 mm or 7 mm | ~20–25 mm | — |

Sheet sizes:

- US filler paper and most spiral notebooks: 8 × 10½ in (203.2 × 266.7 mm).
- Letter-size filler paper: 8½ × 11 in (215.9 × 279.4 mm).
- A4: 210 × 297 mm; A5: 148 × 210 mm.

Other features:

- **Top of the sheet to the first line:** not standardised. Most US filler paper leaves a header band of about 1 in (25.4 mm) before the first blue line, and that's the preset default. Measure your own paper.
- **Right boundary:** there's no right margin line. Writing usually stops 5–8 mm from the right edge, and the presets use 6 mm.
- **Three-hole punch:** holes are 4¼ in apart, centred about ⅜ in from the left edge.

Spacing and the margin position are consistent across retailers (for example, a Staples college-ruled 8 × 10½ in filler pack lists 33 lines). The top header band and exact line count vary by brand. That's why every value in the app can be edited, and the calibration dialog has a **Measure spacing precisely** helper. Measuring from the top edge to the first and last lines and dividing by the line count averages out ruler error across 25+ lines.

## Why printing needs calibration

Even with "100% / Actual size" and "Margins: None", printers have three kinds of error:

1. **Offset.** The sheet sits a little off from where the driver assumes, for example because of feed-guide play or a centred tray. This usually adds up to 0.5–3 mm.
2. **Scale.** Some drivers shrink the output slightly to fit their printable area. This is often 97–99%.
3. **Unprintable edges.** Most printers can't print within 3–6 mm of the edges. Content placed there is clipped.

The app models what the printer does as `landed = sent × scale + offset` on each axis. The test page has two crosshairs, A at (20, 20) mm and B 20 mm in from the bottom-right corner. Measuring both from the sheet edges gives the scale and the offset. When printing, content is pre-corrected with `sent = (wanted − offset) / scale`, plus a feed offset for sheets that sit centred or right-aligned on larger media, plus optional ±0.25 mm nudges. The verification page applies the correction. Its ticks should sit on the blue lines and the red margin.

## Browser printing details

- The print stylesheet sets `@page { size: <W>mm <H>mm; margin: 0 }` and draws each page as an SVG at exact millimetre size, so nothing gets reflowed or resized.
- In the print dialog, turn off headers and footers. Choose the paper size that matches the profile, which you may need to add as a custom size for 8 × 10½ in sheets.
- The notebook overlay (white sheet, blue rules, red margin and holes) is never part of a print or export. "Download PDF for this printer" bakes in the printer profile, so the PDF prints accurately from any PDF viewer at 100%.
