# DESIGN.md — WA Blast dashboard

## Who and where
Restaurant captains, mostly on a mid-range Android phone, between shifts. They open the dashboard to answer one
question, "is my promo going out?", and to press one button (NYALAKAN / MATIKAN). A supervisor checks all outlets
from a laptop. Copy is plain Indonesian ("bahasa bayi"): short sentences, no jargon.

## Personality
Warm and calm, like a well-run restaurant floor: dependable, not flashy, not "tech". The screen should feel
finished and trustworthy enough that a captain does not worry they broke something.

## Dials
- ENERGY 2: quiet surfaces, one confident colour.
- RHYTHM 2: the overview (bento) differs from the working tabs below it; cards inside a tab stay consistent.
- MOTION 1: hover/press feedback and the progress bar only. No loops, no entrance animations.

## Colour (light only; outlets use the dashboard in daylight, and one theme halves the QA)
| Token | Value | Use |
| :--- | :--- | :--- |
| `--bg` | `#f6f3ee` | Page: warm linen, not clinical white |
| `--surface` | `#ffffff` | Cards and inputs |
| `--surface-2` | `#faf8f4` | Quiet inner panels, list hover |
| `--border` | `#e6e0d6` | Card edges |
| `--control-border` | `#8a8377` | Input edges (3.75:1, WCAG 1.4.11) |
| `--text` | `#1c1a17` | Body |
| `--muted` | `#5f5950` | Secondary text (≥ 6:1 on white) |
| `--brand` | `#17603d` | Herb green: the one brand colour. "Send / on / ready", primary buttons, active tab |
| `--brand-soft` | `#e4f0e8` | Ready state backgrounds, chat bubble |
| `--brand-ink` | `#0f3f28` | Text on `--brand-soft` |
| `--danger` | `#b3261e` | Stop / delete / not ready only |
| `--danger-soft` | `#fbeae7` | |
| `--warn-text` / `--warn-soft` | `#7a4a00` / `#fff3d6` | Auto-pause notice only |
No gradients, no glow. Red and amber only ever mean a real problem.

## Type
Plus Jakarta Sans (variable, self-hosted from `@fontsource-variable/plus-jakarta-sans`): designed for Jakarta's
city identity, friendly geometric shapes, very readable at small sizes on phones, and it ties the product to where
it is used. System UI is the fallback. Scale: 13 / 15 / 17 (base) / 20 / 24 / 32 px; weights 500, 600, 700, 800.
Numbers in the overview use tabular figures.

## Space, shape, depth
- Spacing scale: 4, 8, 12, 16, 24, 32, 48.
- Radius: 16 cards, 12 controls and inner panels, 999 only for status pills. Nothing else is pill-shaped.
- Depth: cards are flat with a 1px border. Only the sticky header gets a hairline shadow when scrolled content
  passes under it. The NYALAKAN button has no shadow; its colour and size carry it.

## Layout
- Max width 960px. Phone first, 16px gutters, no horizontal scroll at 320px.
- **Overview bento** sits above the tabs on every screen. It is a bento because its cells really differ in weight:
  1. **Siap kirim?** (largest): the verdict that decides everything else. PC on, WhatsApp linked, inside sending
     hours. Shows the single fix when something is missing.
  2. **Promo berjalan** (wide): the running promo's real progress, or how to start one.
  3. **Terkirim hari ini** and **Kontak** (small): real counts with today's real limit.
  Phone: 1 + 1 + 2 small side by side. Desktop (≥ 760px): 4 columns, verdict spans 2×2.
- Tabs below the overview, then the working area of the chosen tab.

## Components
- Buttons: primary (brand fill), danger (red fill), secondary (white, outlined), link. 48px min height; the
  NYALAKAN/MATIKAN control is 60px. Disabled = 55% opacity, `not-allowed` cursor.
- Inputs: 48px, 12px radius, visible label above, hint text below in muted 15px.
- Status pill: dot + text, only for real states (running, PC on/off, WhatsApp linked).
- Card header: title 20px/700 plus optional one-line description in muted.
- Empty states say why it is empty and the one action that fills it.

## Accessibility
WCAG AA contrast for all text, 3px blue focus ring (`#1d4ed8`) on every focusable element, 44px+ targets,
`prefers-reduced-motion` disables the progress transition.
