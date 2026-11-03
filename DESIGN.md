# DESIGN.md — WA Blast dashboard

## Who and where
Restaurant captains, mostly on a mid-range Android phone, between shifts. They open the dashboard to answer one
question, "is my promo going out?", and to press one button (NYALAKAN / MATIKAN). A supervisor checks all outlets
from a laptop. Copy is plain Indonesian ("bahasa bayi"): short sentences, no jargon.

## Personality
Calm and soft, like a quiet spa lobby: dependable, not flashy, not "tech". The screen should feel finished and
trustworthy enough that a captain does not worry they broke something. Visual reference (2026-11-02): a mobile
app with a muted teal sidebar, white cards on soft shadows, and icon tiles for categories.

## Dials
- ENERGY 2: quiet surfaces, one confident colour.
- RHYTHM 2: the overview (bento) differs from the working tabs below it; cards inside a tab stay consistent.
- MOTION 1: hover/press feedback and the progress bar only. No loops, no entrance animations.

## Colour (light only; outlets use the dashboard in daylight, and one theme halves the QA)
| Token | Value | Use |
| :--- | :--- | :--- |
| `--bg` | `#f3f1ef` | Page: soft warm grey |
| `--surface` | `#ffffff` | Cards and inputs |
| `--surface-2` | `#f6f5f4` | Quiet inner panels, list hover |
| `--border` | `#e8e4e1` | Hairlines inside cards, progress track |
| `--control-border` | `#8a908f` | Input edges (3.25:1, WCAG 1.4.11) |
| `--text` | `#1b2120` | Body |
| `--muted` | `#666b6a` | Secondary text (5.4:1 on white, 4.8:1 on bg) |
| `--brand` | `#3d6b66` | Muted teal, the one brand colour: sidebar, "send / on / ready", primary buttons, active menu |
| `--brand-soft` | `#e2eeeb` | Ready state backgrounds, chat bubble |
| `--brand-ink` | `#1e4440` | Text on `--brand-soft` |
| `--side-text` / `--side-active` | `#d5e6e3` / `#2f5551` | Menu labels on the sidebar (4.65:1), the current item |
| `--danger` | `#b3261e` | Stop / delete / not ready only |
| `--danger-soft` / `--danger-border` | `#fbeae7` / `#efc2bc` | |
| `--warn-text` / `--warn-soft` | `#7a4a00` / `#fff3d6` | Auto-pause notice only |
No gradients, no glow. Red and amber only ever mean a real problem.

## Type
Plus Jakarta Sans (variable, self-hosted from `@fontsource-variable/plus-jakarta-sans`): designed for Jakarta's
city identity, friendly geometric shapes, very readable at small sizes on phones, and it ties the product to where
it is used. System UI is the fallback. Scale: 13 / 15 / 17 (base) / 20 / 24 / 32 px; weights 500, 600, 700, 800.
Numbers in the overview use tabular figures.

## Space, shape, depth
- Spacing scale: 4, 8, 12, 16, 24, 32, 48.
- Radius: 20 cards, 14 controls, menu tiles and inner panels, 999 only for status pills.
- Depth: cards, tiles, lists and menu tiles sit on one soft shadow (`--shadow`) with no border. A red edge
  marks a card that is not ready. Buttons have no shadow; colour and size carry them.

## Layout
- Phone first, 16px gutters, no horizontal scroll at 320px. Order on a phone: header (name + Keluar), overview
  bento, menu as a row of 52px icon tiles (the current one filled teal, label under it), then the working area.
- Desktop (900px+): a 248px teal sidebar holds the name, Keluar and a vertical icon menu; the page fills the right
  column (max 1240px total).
- Supervisors land on **Semua outlet**: one card per outlet, those needing attention first.
- **Overview bento** sits above the tabs on every screen. It is a bento because its cells really differ in weight:
  1. **Siap kirim?** (largest): the verdict that decides everything else. PC on, WhatsApp linked, inside sending
     hours. Shows the single fix when something is missing.
  2. **Promo berjalan** (wide): the running promo's real progress, or how to start one.
  3. **Terkirim hari ini** and **Kontak** (small): real counts with today's real limit.
  Phone: 1 + 1 + 2 small side by side. Desktop (≥ 760px): 4 columns, verdict spans 2×2.

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
