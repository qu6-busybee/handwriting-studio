# Handwriting Studio

Handwriting Studio is a browser editor for making realistic handwritten pages and printing them onto real ruled notebook paper. It works like a small, dark-mode Google Slides that's built around one sheet of notebook paper:

- Place anything anywhere on the page.
- Turn typed text into varied, natural-looking handwriting.
- Print only the ink, lined up with the blue rules already printed on the paper.

It's a static site: plain ES modules with no build step and no server. It runs offline once loaded.

**Use it online:** https://qu6-busybee.github.io/handwriting-studio/

## Run it

```bash
python -m http.server 5173
```

Open http://localhost:5173. Any static file server works. Opening `index.html` directly from disk won't work, because browsers block ES modules on `file://`. The app can also be hosted as-is on GitHub Pages.

## Workflow

1. Pick your physical notebook paper (8 × 10½ in loose-leaf filler is the default), or measure your own and save it as a preset.
2. Arrange text, shapes and diagrams. While you're editing, text shows in a plain digital font with no handwriting effects.
3. When the layout is final, click **Generate Handwriting**. The approved text becomes pen or pencil marks with the same line breaks. Your typed text is never overwritten. **Back to editing** returns to plain text, and **Regenerate this section** re-writes one box.
4. If you change text after generating, that box goes back to plain text and is outlined. Use **Regenerate changed** or **Generate this section** to update it.
5. **Example Print** prints a sample page in your current style:
   - **Preview A** shows it on the virtual notebook paper.
   - **Preview B** shows exactly what the printer outputs (ink only, on white).
   - **Print Test Page** prints it so you can check alignment on a real sheet.
6. Calibrate if needed, check the final **Print** preview, and print onto your notebook paper.

The blue lines, red margin, paper colour and the dashed printable-area box are guides only. Printing and every export contain only what you placed on the page.

## Status

### Implemented

**Editor**
- Free placement of text boxes, shapes, freehand pen and highlighter strokes, and images.
- Drag, resize (8 handles, Shift keeps the aspect ratio), rotate (Shift snaps to 15°), Alt-drag to duplicate.
- Multi-select by Shift-click or marquee, with group and ungroup.
- Layers panel with hide, lock and reorder; bring forward/back.
- Snapping and guides to page edges, the red margin, the writing area and other objects. Text locks its first baseline onto the ruled lines.
- Align and distribute.
- Undo and redo (150 steps).
- Multiple pages with thumbnails, reorder, duplicate and delete.
- Vector zoom from 25% to 600% (Ctrl+wheel, Ctrl+=/−/0) and space-drag panning.
- Copy, cut and paste between pages and projects; paste or drop images; paste plain text as a new text box.
- Keyboard shortcuts: V, T, P, H, R, O, L, A, Delete, arrows (Shift = 5 mm or one ruled line), Ctrl+D, Ctrl+G, Ctrl+A and Ctrl+P.
- Collapsible left and right panels.

**Handwriting engine**
- Text is laid out glyph by glyph from handwriting fonts. It isn't rendered as a font: each letter's outline is transformed individually.
- **Writer identity:** a project-wide seed sets slant and per-letter habits, so every page looks like the same person wrote it. **New writer** changes the identity.
- **Instance variation:** per-glyph rotation, scale, baseline offset and spacing jitter, plus line tilt, baseline drift and left-margin wobble.
- **Shape variation:** a smooth warp field applied in line space, so repeated letters never match while cursive joins stay connected.
- **Controls:** 12 built-in styles (neat, casual, rushed and cursive), Neat/Casual/Rushed manner, letter size (x-height in mm), neatness, slant, letter and word spacing, line spacing (follows the paper ruling by default), baseline drift, ink variation, pen weight and pen width.
- **Two stages:** plain-text editing (Inter), then explicit **Generate Handwriting**. Both stages wrap lines with the same metrics, so generation never moves line breaks. A writer squeezes letters slightly to finish a line rather than re-wrapping it.
- **Pens:** ballpoint (rough edges, patchy density), gel (smooth, saturated) and pencil (graphite grain plus pressure shading, with HB, 2B and 2H tones). Every pen gets per-word pressure variation in both ink density and stroke weight. Ink colours: blue, black, gel blue, red, or any custom colour.
- **Edits:** `~~cross out~~` and `__underline__` markup, a Tab paragraph indent, and an optional "natural mistakes" setting that misspells, crosses out and rewrites words.
- **Editable output:** every text box regenerates on its own when you edit it. **Rewrite with new variation** re-rolls a single box.
- **Your own handwriting:**
  - *Draw your letters:* write characters on guide lines with a mouse or stylus, with multiple samples per letter for variety.
  - *Scan a sample sheet:* print a template, fill it in, then photograph or scan it. Drag four dots onto the corner marks, and the app rectifies the image (homography), thresholds each cell and traces vector outlines.
  - *Upload a font:* TTF, OTF or WOFF.
  - Characters you haven't provided fall back to a neat print style.

**AI Auto-Layout** (toolbar, or **Insert → AI Auto-Layout…**)
- **Input:** paste or type text; import .txt, .md, .csv or .docx; add one or more images. Each image can be read with on-device OCR (Tesseract, loaded on first use) or placed as a diagram.
- **Structure recognition:** headings and subheadings, paragraphs (re-joining lines that were hard-wrapped when copied), bulleted, numbered and nested lists, term–definition pairs, questions with their answers, tables (tab, CSV or Markdown), and equations. You can review and correct each detected type before placing. Wording is never rewritten, summarised or dropped.
- **Placement:**
  - Text sits on the ruled lines, between the red margins and the top and bottom boundaries, at your handwriting size, after any existing content.
  - Pages are added as needed. Text is never shrunk and never runs past the bottom.
  - Headings stay with what follows, short definitions and lists stay together, and long paragraphs continue across pages.
  - Questions stay with their answers, and answers, list levels and equations are indented.
- **Result:** everything arrives as plain, editable text for review. Nothing is handwritten until **Generate Handwriting**.
- **What it is:** by default, recognition is rule-based and runs entirely in your browser; nothing is sent to an online AI service. On-device OCR quality depends on the image, and photos of handwriting or complex diagrams won't convert to text reliably.
- **Optional Claude recognition (bring your own key):**
  - Add an Anthropic API key in the Auto-Layout dialog. Then **Recognize with Claude** sends the text, plus images marked **Read with Claude** or placed as diagrams, to Claude Opus 5.5 through the official Anthropic JavaScript SDK (0.133.0, loaded on first use).
  - Claude returns the structure as JSON (structured outputs). It is told to transcribe exactly and never rewrite, summarise or drop content, and it can mark figures inside images to be placed as pictures.
  - The result appears in the same review list before anything is placed, along with the token usage and an estimated cost.
  - Your key stays in your browser: in memory for the session, or in local storage if you tick "Remember on this device". Requests go directly from your browser to `api.anthropic.com`, and usage is billed to your Anthropic account. Server-side refusal fallbacks are enabled, so if a safety classifier declines, another model completes the request.
  - Use a key with spending limits you're comfortable with. Anyone with access to your browser profile can read a remembered key.

**Handwriting settings** (right panel, per text box or for the whole document)
- **Live sample:** shows how the settings look as finished handwriting, even while the page is still in editing mode.
- **Instruments:** ballpoint, gel, fountain, fine-tip, mechanical pencil, graphite pencil and marker. Each has its own texture filter and stroke behaviour.
- **Colours:** standard, dark and light blue, black, blue-black, red, green, purple, any colour picker value, or a HEX code.
- **Colour per word:** select words in the on-page editor and click a colour, or write `[red]…[/]` / `[#hex]…[/]`. Recolouring after generating keeps the handwriting.
- **Intensity:** ink darkness, pen pressure, stroke thickness, ink consistency, stroke variation, ink texture, pencil softness and opacity.
- **Style:** print or cursive, style, size, neatness, writing speed, slant, word and letter spacing.
- **Variation:** baseline, letter shape, and line-to-line consistency.
- **After generating:**
  - **Regenerate this section** re-writes a whole box.
  - **Rewrite words** (in the on-page editor) re-writes only the selected words; every word has its own variation.
  - **Restore typed text** turns a box back into plain text.
  - **Apply to entire document** copies the current settings to every text box.
- Shapes and drawings can use any instrument and pressure too, for example a mechanical-pencil diagram.

**Paper, printing and export**
- Presets for wide, college and narrow ruling (8 × 10½ in filler and Letter), A4 8 mm and 7 mm, and A5. Every measurement is editable, and a measure-across-many-lines helper sets precise spacing (see [docs/PAPER.md](docs/PAPER.md)).
- **Paper library and Paper Studio** (the **Paper Settings** button, and every new project):
  - **Library:** your saved papers, each with a preview, size and ruling, plus starting templates. Use, edit, duplicate, rename or delete a paper, or start from **+ Create New Paper**.
  - **Studio:** a large live preview with rulers and a compact panel. Drag the first line, the spacing line, the last line, any single line or the red margin; live measurements follow the cursor. Click a line to adjust just that one. Drafts autosave and can be resumed, with undo/redo.
  - **Last line / bottom edge:** set the gap above the last line or its distance to the bottom edge, hide it, shorten it, or add partial lines. The other lines keep their spacing.
  - **Review & save:** check the exact paper and a summary, name it, then **Save Preset** or **Save & Use**. Creating a paper never overwrites an existing preset; editing a preset updates only that one.
  - **Measurements:** inches show as clean fractions (8 1/2, 11/32, 1/12) and you can type fractions directly. Values that aren't exact fractions show as short decimals. Everything is stored in millimetres at full precision.
- **Adjust on page** (from the library): the same settings applied live to the current project, with rulers and drag handles on the canvas:
  - **Size:** width and height in in, mm or cm; portrait or landscape; top, bottom, left and right writing margins; on-screen paper colour; the printer-safe edge.
  - **Horizontal lines:** spacing (slider or exact value), first-line position, line count (automatic or manual), thickness, colour, opacity, start and end positions, and a small angle for slightly crooked paper.
  - **Red margin:** position, thickness, colour, opacity, start and end, show or hide, plus any number of extra vertical lines.
  - **On the canvas:** rulers in real units, and drag the first line, the spacing line, the margin or extra lines while a live measurement shows. Shift gives finer steps. Undo/redo, reset to preset and save preset work throughout.
  - **Storage:** settings are saved per project, and paper presets are reusable across projects. Printer calibration stays independent of the paper settings.
- **Alignment:**
  - Text sitting on a ruled line keeps its line number when the spacing or first line changes, and text at the margins follows them.
  - With "Size follows lines" on, handwriting scales with the line spacing (e.g. 8.7 mm → 7.1 mm).
  - The margins are optional snapping edges. Hold Alt while dragging, or turn off "Sit on ruled lines", to place text freely.
- **Print modes:** *Handwriting only* (the default, for real lined paper), *Paper template only* (lines and margins on blank paper) and *Handwriting + paper*. Previews, printing and PDF/PNG exports all follow the selected mode. The paper colour and punch holes are never printed.
- The notebook overlay is visual only and is never printed or exported in "Handwriting only" mode.
- **Your own paper presets:** measured paper can be saved as a preset (stored in the browser).
- **Printable area:** a dashed box shows where your printer can reach, based on its unprintable edge and how the sheet is fed. The print preview warns about items that would be clipped.
- **Units:** inches or millimetres in the properties panel and the calibration dialog.
- **Example Print:** a sample page with Preview A (on notebook paper) and Preview B (printer output), plus **Print Test Page**.
- **Calibration:** pick the paper and the printer media (same as notebook, Letter or A4), and set where the sheet sits (left, centre or right guide). Then print a test page, enter the measured crosshair positions to get scale and offset correction, fine-tune in ±0.25 mm nudges, and print a verification page. Profiles are saved in the browser.
- **Printing:** direct browser printing at exact physical size (`@page` size with zero margins), multi-page, with the printer correction applied.
- **Print preview:** shows exactly where ink lands, with an optional reference-only notebook overlay.
- **Exports:** multi-page PDF at 200, 300 or 600 dpi (plain, or with the printer profile baked in) and transparent PNG per page.
- **Saving:** projects autosave to the browser (IndexedDB). The project list lets you open and delete projects, and **Save a copy to file** / **Open from file** use a `.hwstudio.json` file that embeds images and any custom handwriting styles it uses.

### Planned / not yet implemented
- Vector (non-raster) PDF export. PDFs are currently high-dpi raster, which preserves the ink texture.
- A neural, stroke-based handwriting model for fully generative letterforms. The current engine varies real glyph outlines.
- Automatic corner-mark detection for scans (marks are placed by hand today).
- Connecting strokes between separately drawn custom glyphs for cursive custom styles.
- Rich text inside one box (mixed colours or styles per word). Today you use separate boxes.
- Syncing projects across devices.

## Inspiration: HandTextAI

[HandTextAI](https://handtextai.com/) converts text to handwriting with numbered font styles, size, spacing and margin controls, paper backgrounds, ink-flow and handwriting variation, custom font upload (Premium), and JPG, PNG or PDF export. The parts that informed this app are adjustable variation, paper awareness, multi-page PDF and custom handwriting. The main differences here:

- Free placement of every element instead of reflowed text.
- Physical print calibration to real notebook paper, instead of rendering the paper into the image.
- Custom handwriting from drawings or a scanned photo of your own writing, not only from font files.

## Architecture

```
index.html              app shell
css/app.css             dark UI theme, print stylesheet
js/main.js              boot, restore last project
js/state.js             project model, selection, undo/redo, autosave (IndexedDB)
js/store.js             tiny IndexedDB wrapper
js/paper.js             paper presets, ruling geometry, overlay
js/print.js             print, preview, calibration, PDF/PNG export, project files
js/editor/canvas.js     page SVG, pointer tools, transforms, snapping, zoom, text editing, shortcuts
js/editor/render.js     objects → SVG (handwriting, hand-drawn shapes, ink filter)
js/handwriting/engine.js   layout + variation engine
js/handwriting/styles.js   style registry, font/glyph providers (opentype.js)
js/handwriting/capture.js  draw/scan/upload personal handwriting
js/ui/*                 top bar, side panels, properties, controls, icons, modals
vendor/                 opentype.js 1.3.4, jsPDF 2.5.2
fonts/                  handwriting fonts (SIL Open Font License, via Fontsource)
```

All geometry is in millimetres. Each page is an SVG whose `viewBox` is the paper size in mm, so zooming, printing and exporting all share one coordinate system with no unit conversions between them.

## Credits

Handwriting fonts (all SIL Open Font License 1.1, from Google Fonts via Fontsource):
- Nanum Pen Script
- Caveat
- Indie Flower
- Kalam
- Shadows Into Light
- Covered By Your Grace
- Reenie Beanie
- Zeyada
- Cedarville Cursive
- Homemade Apple
- Dawning of a New Day
- La Belle Aurore

Libraries: [opentype.js](https://github.com/opentypejs/opentype.js) (MIT) and [jsPDF](https://github.com/parallax/jsPDF) (MIT).
