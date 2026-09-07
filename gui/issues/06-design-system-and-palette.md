# Establish the design system and soft palette

Type: prototype
Status: resolved
Blocked by: 02

## Start here

New session? Read these first — they hold decisions already settled; do not relitigate them.

- **[The map](../map.md)** — the `## Notes` section is the binding list of standing decisions,
  and `## Decisions so far` indexes every resolved ticket. Read it before anything else.
- **[CONTEXT.md](../../CONTEXT.md)** — glossary. Mirrors upstream tokscale's vocabulary
  verbatim, including the ambiguities it inherits. Use these terms exactly.
- **[ADR 0001](../../docs/adr/0001-depend-on-tokscale-core.md)** and
  **[ADR 0002](../../docs/adr/0002-fork-tokscale-cli-for-a-library-target.md)** — both carry
  dated amendments; read to the end.
- Resolved research lives in sibling tickets `03`, `04` and `05`. Zoom into them on demand
  rather than re-researching.

Upstream tokscale source is at `tokscale/` in the repo root today; after
"Fork tokscale and vendor it as a submodule" resolves, it lives at `vendor/tokscale/`.

**Skill for this ticket type:** Call the Skill tool with `prototype`. This is HITL — iterate with the human;
  never answer their side of it yourself.

## When done

1. Append the answer to this file under `## Answer

**Ruled, on shadcn's token contract.** Three registers were built against real
data and flipped through in the running window, in both themes: *Quiet*
(structure by tint, 34px rows), *Ruled* (structure by hairline, 27px rows,
mono figures) and *Editorial* (cards, shadow, 40px rows, a 30px display total).
Ruled wins on the data shapes ticket 08 measured: every Group-By yields 38–198
Entries, three of the four P1 views are dense tables, and Ruled is the only
register where a full report *and* the Contribution Graph fit one 760px window
without scrolling. Editorial's 40px rows would have made a 198-row Models report
a scroll marathon, and its accent block was louder than "low contrast" allows.
One thing was tempered on promotion: column heads are sentence-case, not
lowercase — the lowercase-mono labels were terminal cosplay rather than
information, and the map asks for t3code's register, not the TUI's.

### The palette is shadcn's token contract, not a parallel one

`shadcn/ui` is now actually installed (radix primitives, Nova preset) and the
palette is defined *as* `--background` / `--card` / `--primary` / `--muted` /
`--border` / `--sidebar-*` / `--ring`, so every component added later inherits it
without a second mapping. Values live in `src/styles.css`.

**Accent, derived rather than picked.** tokscale's `#0073FF` is
`oklch(0.5886 0.2258 258.78)`. The app accent halves the chroma and walks the hue
about 11° warmer so it sits *inside* the stone instead of on top of it:
`oklch(0.545 0.115 250)` light, `oklch(0.660 0.100 248)` dark. The stone base is
hue 75–80 with chroma 0.004–0.006 — warm enough to read as warm, far enough from
`#0B0B0B` tinted-black to not be it.

The accent is spent in exactly two places: the primary action, and the Ramp.
Nothing else in the window is saturated, which is what makes the graph read as
the one chromatic event rather than as decoration.

**Cost Source rides on the figure's own color** rather than a badge, because
CONTEXT.md is explicit that a displayed cost is only as trustworthy as its
provenance: `ProviderReported` is plain `--foreground` and gets no token;
`--cost-estimated` is warm (`oklch(0.560 0.085 70)` / `oklch(0.720 0.075 70)`);
`--cost-unknown` recedes. The full source name is in the tooltip.

### Type scale and numeric font

Six sizes, and P1 uses no others. Note `figure` outranks `title` on purpose — on
every view the number is what the user opened the app for, and the heading is
signposting.

| Token | Size | Use |
| --- | --- | --- |
| `--text-micro` | 11px | column heads, unit labels |
| `--text-small` | 12px | secondary text, timestamps |
| `--text-body` | 13px | default UI text, table cells |
| `--text-title` | 16px | view title |
| `--text-figure` | 17px | summary-tile figures |
| `--text-display` | 30px | reserved: one headline figure |

**Two faces.** `--font-sans` is SF (`-apple-system`), because the window lives
beside Finder and should sound like it. `--font-mono` is **Geist Mono**, used for
figures only. `tabular-nums` alone was not enough: the specimen showed that a
mono advance beats a proportional one for columns of mixed-width figures, and it
is what makes `$113.42` and `$4.31` line up without hand-tuned column widths.
Geist Mono ships via `@fontsource-variable/geist-mono`, so there is no network
font fetch in a desktop app.

### Density

`--row-h: 27px` for data-table rows, on a 4px rhythm, with `--gutter: 24px` as
the content gutter and a 180px sidebar. Chosen against 10 real rows at the
minimum window height, not in the abstract.

### The Ramp

Five steps, walked in oklch from the accent's hue. Lightness and chroma move
together in opposite directions across the two themes, so **the steps separate by
lightness alone** — a dichromat reads the graph from the same five values.

| | dark | light |
| --- | --- | --- |
| `--ramp-1` | `oklch(0.300 0.040 248)` | `oklch(0.905 0.030 248)` |
| `--ramp-2` | `oklch(0.405 0.064 248)` | `oklch(0.809 0.056 248)` |
| `--ramp-3` | `oklch(0.510 0.087 248)` | `oklch(0.713 0.083 248)` |
| `--ramp-4` | `oklch(0.615 0.111 248)` | `oklch(0.616 0.109 248)` |
| `--ramp-5` | `oklch(0.720 0.135 248)` | `oklch(0.520 0.135 248)` |

`--ramp-0` (`oklch(0.240 0.005 75)` / `oklch(0.958 0.003 80)`) is **not a step**.
It sits *further* from `--ramp-1` than any two real steps are from each other, in
both themes, so absence cannot be misread as a sixth low step.
A day with no usage is absence, not the lowest intensity, and it is a separate
token from `--muted` — the specimen showed it is the only thing giving the graph
its grid in light mode, where the card behind it is nearly the same value.
Ticket 12 gets real values, not a gesture at a ramp.

### Theme switching — resolved, and it is not a class swap

Three states, `system | light | dark`, stored in `gui.json` as `appearance`,
defaulting to `system`. `src/theme.ts` is the only place a theme changes, and it
performs **both** writes together: `getCurrentWindow().setTheme()` on the Tauri
window, and `data-theme` on the document. `system` passes `null` to `setTheme`,
handing the window back to macOS, and a `onThemeChanged` listener keeps the
document in step when the system flips underneath — see the fourth finding below
for why it is that and not `matchMedia`.

Two things make that hold:

- **shadcn's `dark` variant was rekeyed.** It ships as `&:is(.dark *)`, which
  cannot key off the window theme; it is now
  `&:is([data-theme="dark"], [data-theme="dark"] *)`. That single change is what
  makes one write serve the palette *and* every shadcn component, instead of a
  class and a window theme that can drift.
- **`tauri.conf.json` no longer pins `theme: "Dark"`.** The pin existed only
  because there was no runtime switch; keeping it made "system" unresolvable, as
  below. The window now follows macOS at creation and `setTheme` steers it after.
- **The window is created hidden** (`visible: false`) and the frontend shows it
  after setting the theme, so the first frame already wears the right
  NSAppearance. Showing first and correcting after gives a visible flash of the
  wrong vibrancy. Rust's `setup` shows the window anyway after 1500ms, so a
  frontend failure cannot leave the app windowless — a blank window is
  debuggable, no window is not.

Capabilities gained `core:window:allow-set-theme` and `core:window:allow-show`;
`core:default` grants neither.

**`tuiLightMode` is deliberately not consulted.** It means "my *terminal* has a
light background", which is a different surface from this window, and one machine
can reasonably want a dark GUI beside a light terminal. The GUI neither reads nor
writes it. It surfaces on the P2 settings screen as a TUI setting listed among
tokscale's own options, never as the GUI theme.

### Four things only the running window could show

- **The lockstep actually works.** In the light captures the vibrant sidebar
  tracks the content. That is precisely the desync ticket 03 hit with an unset
  `theme`, and it is now demonstrated fixed rather than argued fixed.
- **The Contribution Graph has to lead on Stats.** 206 days of cells below a
  ten-row table is below the fold at the 760px default height, and the Ramp is
  the only place the accent is spent — it cannot live off-screen. The graph moved
  above the table in all three specimens for that reason.
- **`tabular-nums` was not sufficient on its own**, which is why the numeric font
  became a real decision rather than a checkbox.
- **"System" was circular, and only a launch on a light machine showed it.** The
  first promoted build rendered dark on a Light-mode Mac. Inside a WKWebView
  `prefers-color-scheme` reports the *window's* NSAppearance, not the OS's — and
  the window was pinned `theme: "Dark"` — so `matchMedia` read back the pin and
  "system" could only ever resolve to dark. `tsc` was clean throughout. The fix
  is two parts: drop the pin, and resolve "system" by handing the window to macOS
  (`setTheme(null)`) *first* and then asking `window.theme()` what it ended up
  wearing. Asking before setting reads the value you are about to replace. For
  the same reason the "system" listener is Tauri's `onThemeChanged`, not a media
  query.

### What is deliberately not built here

The register is the token layer and the shell. **The P1 tables are ticket 10's
job and the graph is ticket 12's**, so `--row-h`, `tnum`, `--font-mono`, the Ramp
and the Cost Source colors have no consumer in the tree yet — they were exercised
and screenshotted in the prototype, which is deleted per the ticket type. Two
things were done so the scale is binding rather than aspirational when those
tickets land: the type and density scale reach Tailwind as real utilities
(`text-body`, `px-gutter`, `h-row`), and **Tailwind's own `--text-xs/sm/base` are
rebound onto it**, because the generated shadcn components are written with those
and would otherwise quietly introduce a 14px step the scale does not have.

### Fog cleared

`## Not yet specified → Theme switching` is resolved and removed. #10 and #12 are
unblocked. No new tickets: what this sharpened lands inside tickets that already
exist — the stored `appearance` key is part of the settings screen's open
question, and the Ramp values are exactly what #12 was waiting on.
