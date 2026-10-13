# Deal Tracker design system

The goal is software that feels like a private bank's instrument: calm, precise, fast and trustworthy. This document records the research behind the choices, what we removed and why, and the rules that keep the product consistent.

## 1. What the research says

| Finding | What it means for us |
|---|---|
| **Aesthetic–usability effect.** In the original ATM study (252 participants, 26 layouts), how good an interface looked tracked how easy people *thought* it was more closely than how easy it actually was. [1] | Visual polish is part of usability for a tool people judge in the first minute. It is not decoration. |
| **Processing fluency.** People find things that are easy to perceive (symmetry, contrast, repetition, prototypical form) more beautiful, and also more *true*. [2] | One grid, one rhythm, identical repeated elements and predictable placement. A finance tool that is easy to read is also easier to believe. |
| **Restraint signals value.** Shoppers estimated higher prices for the same shoes in emptier stores, and products look more valuable with empty space around them. The effect varies by product type. [3] | Fewer containers, more space, colour only where it carries meaning. |
| **Speed reads as quality.** About 100 ms is where an interaction feels instant [4]. The classic 400 ms "Doherty threshold" is a useful heuristic, though not a hard law. [5] | Every click responds immediately: optimistic updates, prefetch on hover, cached views. Nothing waits silently. |
| **Skeleton screens can make waits feel longer.** In Viget's controlled test, skeleton screens were judged slower than a spinner or a blank screen. [6] | We don't fake loading states. We make views appear instantly from cache and refresh them quietly. |
| **Labour illusion.** People value a result more when they can see the work that produced it, but only when the steps are specific. A blind progress bar backfires. [7] | When the app does real work (reading a CIM), it narrates the real steps: pages read, years of financials found, facts detected, prior looks checked. Each line reports an actual result. Lines are paced 160 ms apart so they can be read (under a second in total, none with reduced motion); the work itself is never padded. |
| **Peak–end rule.** People remember an experience by its most intense moment and its ending. [8] | We craft the peaks: closing a deal, finishing a handover, the first CIM read. Every flow ends with a clear, quiet confirmation. |
| **Craft in practice.** Linear's redesigns focused on cutting visual noise, not giving every element equal weight, and aligning labels, icons and buttons precisely. [9] | Hierarchy through weight and position, not boxes and colour. |

**Ethics.** These effects are used to make good software *legible*, never to mislead. We add no fake urgency, no artificial waiting, no hidden costs and no confirm-shaming. Destructive actions are reversible or clearly confirmed.

## 2. What made it look generated (removed)

- **Glyphs and emoji as icons** (§ ↺ ❄ ⏱ 📍 🗓 ✦ ▲). Replaced with one line-icon family.
- **Gradient washes** on company cards and the company header.
- **Saturated initial tiles and hexagon "logos"** for demo companies. Replaced with quiet monograms.
- **A card around everything**, all with the same radius and shadow. Sections are now separated by space and hairlines. Cards are reserved for objects you can pick up: a company, a deal card, a dialog.
- **A row of KPI tiles under "Good morning, {name}".** Replaced with a single metrics strip under a plain title.
- **Chip overload**: country, deal type, lead, priority and stage all as pills. Now plain text with middots. Pills are kept only for state.
- **Blue on everything**: icons, bars, buttons, links. Ink is now the primary colour, and the accent is reserved for focus, selection and the one thing that matters on a chart.
- **Bars that are all 100% wide**: one deal per stage drawn as full bars. Bars now encode value against a shared scale.
- **Pill-shaped buttons everywhere.** Buttons are now 8 px rounded rectangles, in the same family as macOS controls.

## 3. Foundations

**Typography**
- UI text uses the system face: SF Pro on Apple devices, Segoe UI Variable on Windows. Body is 14 px; secondary text is 13 px.
- Display text uses a serif: `ui-serif` (Apple's New York on macOS and iOS), falling back to the bundled Source Serif 4. It appears in page titles, company names and the one-pager, and nowhere else.
- Numbers use tabular figures in the UI sans at weight 600, sized for reading and comparing (19–24 px for headline figures), the way a data room or terminal sets them. Thin display numerals look good on a slide but are harder to scan and read as decoration.
- Scores are shown as the facts behind them. A deal record is "5 of 7" plus what is missing ("Missing model, meeting notes"), not "71%". A firm-wide view is a table of which deals lack which item, not one big percentage.
- Labels are sentence case. Uppercase is used only for 11 px eyebrows, with +0.06em tracking.

**Colour**
- Neutrals are slightly cool. Light canvas `#F7F7F8` with white surfaces. Dark canvas `#0B0B0D` with `#141417` surfaces.
- Ink (`#0E0F12` light, `#EDEDEF` dark) is the primary action colour.
- One accent (cobalt `#3155E6` light, `#7B93FF` dark) for focus, selection, links and highlighted data.
- Status colours (good, warning, critical) are used only for state, and always with an icon or label.
- A company's brand colour appears only in its monogram and as a 6 px dot.

**Space and shape**
- A 4 px base grid. Page gutter 40 px. Section gap 48 px.
- Radii: 6 px for controls, 10 px for cards, 14 px for dialogs.
- Hairlines are 1 px at 8% ink. Shadows only for things that float (menus, dialogs, dragged cards).

**Iconography**
- Lucide line icons at 16 px with a 1.5 px stroke.
- In navigation, icons are secondary ink; the active item is primary ink.

## 4. Motion

| Token | Duration | Use |
|---|---|---|
| `--dur-1` | 120 ms | press, hover, toggle |
| `--dur-2` | 200 ms | menus, toasts, popovers |
| `--dur-3` | 280 ms | dialogs, page transitions |

- Easing: `cubic-bezier(.16, 1, .3, 1)`, an exponential ease-out. Things arrive quickly and settle softly.
- Page changes use the View Transitions API: an 8 px rise with a cross-fade.
- Lists stagger in on first view: 16 ms per row, at most 10 rows.
- Figures never animate. Numbers are read and compared, not performed.
- Only `transform` and `opacity` are animated. `prefers-reduced-motion` turns all of this off.

## 5. Behaviour

- **Command palette (⌘K / Ctrl K).** Search everything, jump anywhere, run any action.
- **Keyboard shortcuts.** `C` new company, `M` log meeting, `U` upload CIM, `/` search, `G` then `O/P/C/M/T` to navigate, `?` to show all shortcuts.
- **Optimistic updates.** Stage moves land instantly. If the server disagrees they roll back, and every move offers **Undo** for 6 seconds.
- **Instant views.** Recently loaded views are shown from cache and refreshed in the background. Company pages are prefetched when you hover a company.
- **Real progress.** CIM analysis shows its actual steps as they complete.
- **Peaks.** Closing a deal shows a short summary of the journey: days from first look, meetings held and people involved.

## Sources
1. Kurosu & Kashimura (1995), via [Laws of UX](https://lawsofux.com/aesthetic-usability-effect/) and [Wikipedia](https://en.wikipedia.org/wiki/Aesthetic%E2%80%93usability_effect). Later critique: [UXPA Journal](https://uxpajournal.org/?p=4392).
2. Reber, Schwarz & Winkielman (2004), *Processing fluency and aesthetic pleasure*. [PDF](https://pages.ucsd.edu/~pwinkielman/reber-schwarz-winkielman-beauty-PSPR-2004.pdf)
3. O'Guinn, Tanner & Maeng (2015); Sevilla & Townsend (2016), summarised by [Nick Kolenda](https://nickkolenda.com/tactics/luxury-brands-minimalism). Counter-evidence: [University of Twente thesis](https://essay.utwente.nl/essays/107030).
4. [Superhuman, "applying the 100ms rule"](https://blog.superhuman.com/superhuman-is-built-for-speed/)
5. Doherty & Thadani (1982), via [Laws of UX](https://lawsofux.com/doherty-threshold/)
6. [Viget, "A Bone to Pick with Skeleton Screens"](https://www.viget.com/articles/a-bone-to-pick-with-skeleton-screens)
7. Buell & Norton (2011), *The Labor Illusion*, Management Science. [INFORMS](https://pubsonline.informs.org/doi/fpi/10.1287/mnsc.1110.1376)
8. Kahneman et al. (1993), via [UX Planet](https://uxplanet.org/alls-well-that-ends-well-how-the-peak-end-rule-affects-user-experience-f2170f98dc63)
9. Linear, [How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui) and [Behind the latest design refresh](https://linear.app/now/behind-the-latest-design-refresh)
