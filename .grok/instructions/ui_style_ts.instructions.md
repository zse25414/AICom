---
version: alpha
name: Teal Studio
description: |
  A clean, single-surface product system built around a calm teal-to-white canvas that reads like a modern SaaS dashboard — quiet, precise, and information-dense without visual noise. The layout is structured around a persistent white canvas (`#FFFFFF`) with a single editorial accent: Teal Green (`#2E9888`) that carries every CTA, interactive state, and data highlight. Concrete Gray (`#767777`) provides a second chromatic layer for decorative rules, metadata, secondary labels, and idle iconography, functioning as a tonal bridge between ink and surface. There is no dark canvas mode: the entire system lives on white. Chrome ornamentation is deliberately suppressed — no gradients on structural surfaces, no atmospheric shadows, no decorative fills. Teal operates strictly as a signal color: progress, selection, active state, and primary action. The card system uses subtle teal-washed backgrounds (`#EEF6F5`) to group information without hard borders, and a consistent 6px / 12px / 9999px radius ladder keeps shape vocabulary minimal. Inter is the system typeface, leveraging its optical clarity at small UI sizes while carrying display headlines at weight 300 for a composed editorial tone.

colors:
  primary: "#2E9888"
  primary-pressed: "#267E72"
  primary-active: "#1E6459"
  on-primary: "#ffffff"
  primary-wash: "#EEF6F5"
  primary-wash-deep: "#D9EFEC"
  link-light: "#267E72"
  link-dark: "#52C4B4"
  decorative: "#767777"
  decorative-light: "#A0ABAA"
  ink: "#1A1F1E"
  body-light: "rgba(26,31,30,0.65)"
  mute-light: "#767777"
  ash-light: "#B8C4C2"
  disabled-text: "#C0CCCA"
  canvas: "#ffffff"
  surface-soft: "#F4F8F7"
  surface-card: "#EEF6F5"
  surface-raised: "#E5F0EE"
  hairline: "#E0E8E7"
  hairline-strong: "#C8D5D3"
  warning: "#C0392B"
  warning-surface: "#FDF2F1"
  success: "#2E9888"
  info: "#2E7BB0"
  info-surface: "#EFF5FA"

typography:
  display-xl:
    fontFamily: Inter
    fontSize: 52px
    fontWeight: 300
    lineHeight: 1.2
    letterSpacing: -0.5px
  display-lg:
    fontFamily: Inter
    fontSize: 40px
    fontWeight: 300
    lineHeight: 1.25
    letterSpacing: -0.3px
  display-md:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: -0.2px
  heading-xl:
    fontFamily: Inter
    fontSize: 26px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.1px
  heading-lg:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 0
  heading-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 0
  body-strong:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: 0.1px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 0
  caption-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  caption-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: 0.2px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0.4px
  link-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 0
  button-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0.1px
  button-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0.2px
  button-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0.3px

rounded:
  none: 0px
  sm: 4px
  md: 6px
  lg: 12px
  xl: 20px
  full: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 80px

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-lg}"
    rounded: "{rounded.md}"
    padding: 10px 24px
    height: 40px
  button-primary-pressed:
    backgroundColor: "{colors.primary-pressed}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-lg}"
    rounded: "{rounded.md}"
  button-primary-active:
    backgroundColor: "{colors.primary-active}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-lg}"
    rounded: "{rounded.md}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    border: "1px solid {colors.primary}"
    typography: "{typography.button-lg}"
    rounded: "{rounded.md}"
    padding: 10px 24px
    height: 40px
  button-secondary-pressed:
    backgroundColor: "{colors.primary-wash}"
    textColor: "{colors.primary-pressed}"
    border: "1px solid {colors.primary-pressed}"
    typography: "{typography.button-lg}"
    rounded: "{rounded.md}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    border: "1px solid {colors.hairline-strong}"
    typography: "{typography.button-lg}"
    rounded: "{rounded.md}"
    padding: 10px 24px
    height: 40px
  button-ghost-pressed:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink}"
    border: "1px solid {colors.hairline-strong}"
    rounded: "{rounded.md}"
  button-sm-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-sm}"
    rounded: "{rounded.sm}"
    padding: 6px 14px
    height: 28px
  button-disabled:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.disabled-text}"
    border: "1px solid {colors.hairline}"
    rounded: "{rounded.md}"
  text-input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    border: "1px solid {colors.hairline-strong}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: 9px 12px
    height: 40px
  text-input-focused:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    border: "2px solid {colors.primary}"
    rounded: "{rounded.md}"
    outlineOffset: 0px
  text-input-error:
    backgroundColor: "{colors.warning-surface}"
    textColor: "{colors.ink}"
    border: "1px solid {colors.warning}"
    rounded: "{rounded.md}"
  text-area:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    border: "1px solid {colors.hairline-strong}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: 10px 12px
    minHeight: 96px
  select-input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    border: "1px solid {colors.hairline-strong}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: 9px 36px 9px 12px
    height: 40px
  toggle-on:
    backgroundColor: "{colors.primary}"
    knobColor: "{colors.on-primary}"
    width: 40px
    height: 22px
    rounded: "{rounded.full}"
  toggle-off:
    backgroundColor: "{colors.ash-light}"
    knobColor: "{colors.canvas}"
    width: 40px
    height: 22px
    rounded: "{rounded.full}"
  checkbox-on:
    backgroundColor: "{colors.primary}"
    checkColor: "{colors.on-primary}"
    border: "none"
    rounded: "{rounded.sm}"
    size: 16px
  checkbox-off:
    backgroundColor: "{colors.canvas}"
    border: "1.5px solid {colors.hairline-strong}"
    rounded: "{rounded.sm}"
    size: 16px
  radio-on:
    backgroundColor: "{colors.canvas}"
    dotColor: "{colors.primary}"
    border: "2px solid {colors.primary}"
    rounded: "{rounded.full}"
    size: 16px
  radio-off:
    backgroundColor: "{colors.canvas}"
    border: "1.5px solid {colors.hairline-strong}"
    rounded: "{rounded.full}"
    size: 16px
  tag-default:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.mute-light}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    padding: 3px 10px
  tag-primary:
    backgroundColor: "{colors.primary-wash}"
    textColor: "{colors.primary-pressed}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    padding: 3px 10px
  tag-warning:
    backgroundColor: "{colors.warning-surface}"
    textColor: "{colors.warning}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    padding: 3px 10px
  badge-dot:
    backgroundColor: "{colors.primary}"
    rounded: "{rounded.full}"
    size: 8px
  card:
    backgroundColor: "{colors.canvas}"
    border: "1px solid {colors.hairline}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    padding: 24px
  card-tinted:
    backgroundColor: "{colors.surface-card}"
    border: "none"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: 24px
  card-raised:
    backgroundColor: "{colors.canvas}"
    boxShadow: "0 2px 8px rgba(46,152,136,0.10), 0 1px 3px rgba(0,0,0,0.06)"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: 24px
  data-row:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.none}"
    padding: 12px 0px
    borderBottom: "1px solid {colors.hairline}"
  data-row-selected:
    backgroundColor: "{colors.primary-wash}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.none}"
    padding: 12px 0px
  sidebar-nav:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.none}"
    width: 240px
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.mute-light}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 8px 12px
    height: 36px
  nav-item-active:
    backgroundColor: "{colors.primary-wash}"
    textColor: "{colors.primary-pressed}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.md}"
    padding: 8px 12px
    height: 36px
  topbar:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.heading-md}"
    rounded: "{rounded.none}"
    height: 56px
    borderBottom: "1px solid {colors.hairline}"
  breadcrumb:
    textColor: "{colors.mute-light}"
    activeTextColor: "{colors.ink}"
    typography: "{typography.caption-md}"
    separator: "{colors.decorative-light}"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.mute-light}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.none}"
    padding: 10px 16px
    borderBottom: "2px solid transparent"
  tab-active:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.none}"
    padding: 10px 16px
    borderBottom: "2px solid {colors.primary}"
  tooltip:
    backgroundColor: "{colors.ink}"
    textColor: "#ffffff"
    typography: "{typography.caption-sm}"
    rounded: "{rounded.sm}"
    padding: 6px 10px
    maxWidth: 240px
  progress-bar-track:
    backgroundColor: "{colors.hairline}"
    rounded: "{rounded.full}"
    height: 6px
  progress-bar-fill:
    backgroundColor: "{colors.primary}"
    rounded: "{rounded.full}"
    height: 6px
  avatar:
    backgroundColor: "{colors.primary-wash-deep}"
    textColor: "{colors.primary-pressed}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    size: 36px
  divider:
    color: "{colors.hairline}"
    thickness: 1px
  divider-decorative:
    color: "{colors.decorative-light}"
    thickness: 1px
  link-inline:
    textColor: "{colors.link-light}"
    typography: "{typography.link-md}"
  section-hero:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.display-xl}"
    rounded: "{rounded.none}"
    padding: 80px 48px
  section-tinted:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.display-lg}"
    rounded: "{rounded.none}"
    padding: 80px 48px
  section-teal:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.display-md}"
    rounded: "{rounded.none}"
    padding: 80px 48px
  modal-overlay:
    backgroundColor: "rgba(26,31,30,0.45)"
  modal:
    backgroundColor: "{colors.canvas}"
    border: "1px solid {colors.hairline}"
    rounded: "{rounded.xl}"
    padding: 32px
    maxWidth: 520px
    boxShadow: "0 8px 32px rgba(0,0,0,0.12)"
  callout-info:
    backgroundColor: "{colors.info-surface}"
    border: "1px solid rgba(46,123,176,0.25)"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 12px 16px
  callout-success:
    backgroundColor: "{colors.primary-wash}"
    border: "1px solid rgba(46,152,136,0.3)"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 12px 16px
  callout-warning:
    backgroundColor: "{colors.warning-surface}"
    border: "1px solid rgba(192,57,43,0.25)"
    textColor: "{colors.warning}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 12px 16px
---

## Overview

Teal Studio is a single-surface product design system built for modern desktop applications and data-rich dashboards. The entire system lives on a pure white canvas (`{colors.canvas}` — `#FFFFFF`); there is no dark mode, no full-bleed dark chapter, no alternating band palette. Visual hierarchy emerges from surface tinting — white → soft teal wash (`{colors.surface-soft}`) → teal card fill (`{colors.surface-card}`) → deep teal wash (`{colors.surface-raised}`) — rather than from dramatic canvas shifts.

Teal Green (`{colors.primary}` — `#2E9888`) is the system's single signal color. It fires on CTAs, active states, selected rows, progress fills, focus rings, navigation highlights, and success indicators. Everything that demands user attention is teal. Concrete Gray (`{colors.decorative}` — `#767777`) occupies the second semantic layer: decorative dividers, metadata labels, idle icons, helper text, and placeholder copy. Together, the two non-white colors create a quiet, high-legibility palette that scales across dense data tables, complex forms, and marketing landing sections without visual fatigue.

Chrome ornamentation is minimal by design — no gradients on structural surfaces, no atmospheric box-shadows at rest, and no decorative fills behind content. Cards lift only when they need to communicate interactivity or focus. The single permitted accent gradient (`{colors.primary-wash}` → `{colors.primary-wash-deep}`) appears on avatar placeholders and selected-state highlights only. Inter is the exclusive typeface, chosen for its grid-aligned geometry and exceptional legibility from 11px caption to 52px display.

**Key Characteristics:**
- Single white canvas system — no dark mode, no full-bleed chapter alternation
- Teal (`{colors.primary}` — `#2E9888`) is the universal active/signal color; Concrete Gray (`{colors.decorative}` — `#767777`) is the decoration and metadata register
- 6px `{rounded.md}` for all interactive chrome (inputs, buttons, cards); 12px `{rounded.lg}` for container panels; pills `{rounded.full}` for tags and toggles
- Surface-tint depth hierarchy: `{colors.canvas}` → `{colors.surface-soft}` → `{colors.surface-card}` → `{colors.surface-raised}`
- Inter weight ladder: 300 display / 400 body / 500 emphasis / 600 heading + button — four weights, zero decorative faces
- Section rhythm at `{spacing.section}` (80px); card gutters at `{spacing.lg}` (24px); form field gaps at `{spacing.sm}` (12px)

## Colors

### Brand & Accent
- **Teal Green** (`{colors.primary}` — `#2E9888`): the system's universal signal color. Every primary CTA, active navigation item, focus ring, selected data row, progress bar fill, checkbox and toggle ON state, and success indicator uses this exact value.
- **Teal Pressed** (`{colors.primary-pressed}` — `#267E72`): pressed state for primary buttons and hovered links — approximately 10% darker than primary. Also the text color inside teal-wash tags and active nav items for WCAG AA contrast on `{colors.primary-wash}`.
- **Teal Active** (`{colors.primary-active}` — `#1E6459`): deeply-pressed / keyboard-active state for the primary button — the deepest step in the teal ramp.
- **Primary Wash** (`{colors.primary-wash}` — `#EEF6F5`): the lightest teal surface — used as the background for tinted cards, selected nav items, selected table rows, and success callout surfaces. Sufficient contrast for small `{colors.primary-pressed}` text.
- **Primary Wash Deep** (`{colors.primary-wash-deep}` — `#D9EFEC`): a slightly deeper teal tint for avatar placeholder fills and hover states on `{colors.primary-wash}` elements.

### Decoration & Neutral
- **Concrete Gray** (`{colors.decorative}` — `#767777`): the system's secondary chromatic register. Applied to decorative horizontal rules, idle icon fills, helper text beneath inputs, metadata labels, breadcrumb separators, and placeholder prose. Not used for interactive elements.
- **Decorative Light** (`{colors.decorative-light}` — `#A0ABAA`): a teal-cooled mid-gray for secondary dividers, breadcrumb arrow, and avatar ring borders. The bridge between ink and hairline.

### Surface
- **Canvas** (`{colors.canvas}` — `#FFFFFF`): the primary page and panel background. All content renders on white by default.
- **Surface Soft** (`{colors.surface-soft}` — `#F4F8F7`): the sidebar navigation background, tinted section fills, and light form wrappers. A barely-perceptible teal-washed white.
- **Surface Card** (`{colors.surface-card}` — `#EEF6F5`): the standard tinted card fill — same value as `{colors.primary-wash}`. Distinguishes grouped content from the page canvas without hard borders.
- **Surface Raised** (`{colors.surface-raised}` — `#E5F0EE`): the deepest non-interactive teal surface — used for hovered card states and emphasized callout backgrounds.
- **Hairline** (`{colors.hairline}` — `#E0E8E7`): the default 1px divider on white canvas — subtly teal-tinted so it reads as part of the system rather than a neutral gray rule.
- **Hairline Strong** (`{colors.hairline-strong}` — `#C8D5D3`): input borders and card borders that need slightly more visual weight than a standard divider.

### Text
- **Ink** (`{colors.ink}` — `#1A1F1E`): primary text on all light surfaces. A near-black with a barely-perceptible teal undertone that prevents cold contrast against the teal-washed backgrounds.
- **Body Light** (`{colors.body-light}` — `rgba(26,31,30,0.65)`): paragraph copy and secondary prose. The 65% opacity keeps body text comfortable and slightly recedes from bold headings.
- **Mute Light** (`{colors.mute-light}` — `#767777`): metadata, timestamps, helper text under inputs, breadcrumb labels, idle tab text. Same hex as `{colors.decorative}` — these are semantically the same role.
- **Ash Light** (`{colors.ash-light}` — `#B8C4C2`): placeholder text inside inputs and lowest-emphasis utility copy.
- **Disabled Text** (`{colors.disabled-text}` — `#C0CCCA`): disabled-state text on buttons, inputs, and form fields.

### Semantic
- **Warning** (`{colors.warning}` — `#C0392B`): validation errors, destructive confirmations, and critical alert text.
- **Warning Surface** (`{colors.warning-surface}` — `#FDF2F1`): background fill for inline error callouts and error input states.
- **Success** (`{colors.success}` — `#2E9888`): success state indicator — shares the primary color because Teal IS the success signal in this system.
- **Info** (`{colors.info}` — `#2E7BB0`): informational callout accent — a blue shift off the teal ramp for semantic differentiation.
- **Info Surface** (`{colors.info-surface}` — `#EFF5FA`): background for info callouts.

### Link
- **Link Light** (`{colors.link-light}` — `#267E72`): inline anchor links in body prose on white canvas — slightly darker than primary for WCAG AA compliance at 16px weight 400.
- **Link Dark** (`{colors.link-dark}` — `#52C4B4`): inline link color reserved for any dark-surface moments (e.g., dark tooltip body or the `{components.section-teal}` band).

## Typography

### Font Family
- **Inter** is the sole typeface — a geometric sans-serif optimized for screen rendering at small UI sizes, with extensive OpenType features (tabular numerals for data tables, slashed zero for code contexts). Falls back through `system-ui` → `-apple-system` → `Segoe UI` → `sans-serif`. Unlike PlayStation SST, Inter is freely available and renders identically across platforms with no substitution needed.
- Use Inter's tabular numeric variant (`font-variant-numeric: tabular-nums`) in all data tables, dashboards, and numeric displays for column-alignment stability.

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `{typography.display-xl}` | 52px | 300 | 1.2 | -0.5px | Landing page hero headline |
| `{typography.display-lg}` | 40px | 300 | 1.25 | -0.3px | Section headline, marketing sub-hero |
| `{typography.display-md}` | 32px | 400 | 1.25 | -0.2px | Page title on dashboard or settings |
| `{typography.heading-xl}` | 26px | 600 | 1.3 | -0.1px | Modal title, primary panel heading |
| `{typography.heading-lg}` | 20px | 600 | 1.3 | 0 | Card heading, sub-section title |
| `{typography.heading-md}` | 16px | 600 | 1.25 | 0 | Table column header, inline heading |
| `{typography.body-md}` | 16px | 400 | 1.6 | 0 | Primary body copy, form field values |
| `{typography.body-strong}` | 16px | 500 | 1.5 | 0.1px | Emphasized body, nav item labels |
| `{typography.body-sm}` | 14px | 400 | 1.6 | 0 | Card description, sidebar content |
| `{typography.caption-md}` | 13px | 400 | 1.5 | 0 | Helper text, timestamps, footer notes |
| `{typography.caption-sm}` | 11px | 500 | 1.5 | 0.2px | Badge labels, chip text, overline |
| `{typography.label-md}` | 12px | 600 | 1.4 | 0.4px | Tag / status pill, overline labels, ALL-CAPS usage |
| `{typography.link-md}` | 16px | 400 | 1.6 | 0 | Inline body-prose anchor links |
| `{typography.button-lg}` | 16px | 600 | 1.25 | 0.1px | Primary and secondary CTA buttons |
| `{typography.button-md}` | 14px | 600 | 1.25 | 0.2px | Compact buttons, filter chips |
| `{typography.button-sm}` | 12px | 600 | 1.25 | 0.3px | Icon buttons with labels, table row actions |

### Principles
Inter's design philosophy aligns with the system's restraint: the typeface does not have personality, it has clarity. Weight contrast is the primary hierarchy signal — weight 300 display headlines recede into the composition, letting teal-accented interactive elements advance. The body tier sits at 16px / 1.6 line-height for comfortable long-form reading on dashboard and documentation surfaces. Headings collapse to 1.25–1.3 line-height at larger sizes because inter-line space loses meaning above 20px.

Letter-spacing moves in one direction only: negative for display (draws large letterforms tighter), neutral for body, and positive-micro for labels and buttons (adds optical separation at small sizes). No value exceeds +0.4px to prevent the "printed-form" appearance common in over-kerned enterprise UI.

## Layout

### Spacing System
- **Base unit:** 4px (xxs) with 8px doubling steps.
- **Tokens:** `{spacing.xxs}` (4px) · `{spacing.xs}` (8px) · `{spacing.sm}` (12px) · `{spacing.md}` (16px) · `{spacing.lg}` (24px) · `{spacing.xl}` (32px) · `{spacing.xxl}` (48px) · `{spacing.section}` (80px).
- **Form field gaps:** `{spacing.sm}` (12px) between label and input; `{spacing.md}` (16px) between fields; `{spacing.lg}` (24px) between form sections.
- **Card internal padding:** `{spacing.lg}` (24px) standard; `{spacing.xl}` (32px) for modal panels and hero content cards.
- **Section rhythm:** `{spacing.section}` (80px) between major page sections on marketing surfaces; `{spacing.xxl}` (48px) between sections on dashboard / app surfaces.

### Grid & Container
- **Max content width:** 1200px with 24px outer gutters at desktop, collapsing to 16px at tablet and 12px at mobile.
- **Application shell:** fixed 240px left sidebar (`{components.sidebar-nav}`) + 56px top bar (`{components.topbar}`), with the remaining canvas scrollable.
- **Dashboard card grid:** 12-column fluid grid, card units typically 3-col (4-up), 4-col (3-up), or 6-col (2-up) depending on content density.
- **Data table:** full-width with 12px left cell padding and sticky header; row height 44px default, 36px compact mode.
- **Modal max-width:** 520px standard, 720px wide variant — always centered in the viewport with `{components.modal-overlay}` dimming the canvas.
- **Settings page:** 2-column 280px sidebar + content area at desktop; single-column accordion at mobile.

### Whitespace Philosophy
The system treats whitespace as a tier signal rather than a decorative luxury. White canvas `{colors.canvas}` is never filled except with structural purpose — a tinted section marks a phase boundary; a card fill groups related fields; a divider separates list items. There are no decorative washes, no atmospheric gradients, and no section-separating illustrations. The result is that every added teal element reads as intentional signal because the rest of the canvas offers no chromatic competition.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| 0 — Flat | No border, no shadow | Full-bleed page sections, sidebar, topbar |
| 1 — Hairline | `1px solid {colors.hairline}` | Card borders, table row dividers, form section separators |
| 1.5 — Strong hairline | `1px solid {colors.hairline-strong}` | Input borders, select borders |
| 2 — Focus ring | `0 0 0 3px rgba(46,152,136,0.20)` | Keyboard/mouse focus state on all interactive elements |
| 3 — Resting card | `0 2px 8px rgba(46,152,136,0.10), 0 1px 3px rgba(0,0,0,0.06)` | `{components.card-raised}` — interactive cards, dropdown menus |
| 4 — Modal | `0 8px 32px rgba(0,0,0,0.12)` | `{components.modal}` — always paired with overlay |

The shadow ramp is intentionally teal-tinted at level 3 (`rgba(46,152,136,0.10)`) so that lifted surfaces feel like they belong to the system rather than casting neutral gray shadows. Modal shadow remains neutral because the modal sits above the teal-infused canvas and benefits from pure depth contrast.

### Focus Management
Every interactive element that receives keyboard focus renders the level-2 ring: `box-shadow: 0 0 0 3px rgba(46,152,136,0.20)`. This teal semi-transparent ring complements the `{colors.primary}` border/fill active state without adding color noise at rest. The focus ring MUST NOT be removed — it is the sole accessibility affordance for keyboard navigation in this system.

## Shapes

### Border Radius Scale

| Token | Value | Use |
|---|---|---|
| `{rounded.none}` | 0px | Full-bleed page sections, topbar, sidebar edges, table cells |
| `{rounded.sm}` | 4px | Compact inline tags, checkbox controls, small code blocks |
| `{rounded.md}` | 6px | All interactive chrome: buttons, inputs, selects, tinted data tags |
| `{rounded.lg}` | 12px | Container panels (cards, modal, callout blocks, dropdown menus) |
| `{rounded.xl}` | 20px | Modal dialog corners on large-breakpoint displays only |
| `{rounded.full}` | 9999px | Status tags, toggle controls, avatar chips, progress bars, filter pills |

The radius vocabulary uses a tighter step than PlayStation — 4/6/12 instead of 4/8/16 — because dashboard elements are smaller and denser. The result is a slightly harder-edged feel appropriate for information-dense product surfaces. Pills (`{rounded.full}`) are reserved exclusively for small enclosed objects (tags, badges, toggles) and progress tracks, not for CTA buttons.

## Components

> **Hover states:** subtle `{colors.surface-soft}` background wash at `0.15s ease` — not individually documented per component. Active/pressed states are specified.

### Buttons

**`button-primary`** — the universal Teal CTA
- Background `{colors.primary}` (Teal Green), text `{colors.on-primary}`, type `{typography.button-lg}`, padding `10px 24px`, height 40px, rounded `{rounded.md}`.
- Used for "Save", "Submit", "Create", "Confirm" — every primary action on the canvas.
- Pressed → `{components.button-primary-pressed}` (background `{colors.primary-pressed}`). Keyboard-active → `{components.button-primary-active}`.

**`button-secondary`** — outlined teal variant
- Background transparent, text + border `{colors.primary}`, type `{typography.button-lg}`, padding `10px 24px`, height 40px, rounded `{rounded.md}`.
- Used for "Cancel" (when paired with a primary), "Edit", "View details" — actions that are important but subordinate to the primary CTA.
- Pressed → `{components.button-secondary-pressed}` (background fills to `{colors.primary-wash}`).

**`button-ghost`** — neutral outline variant
- Background transparent, text `{colors.ink}`, border `{colors.hairline-strong}`, rounded `{rounded.md}`.
- Lowest-emphasis actions: "Back", "Dismiss", tertiary navigation. Makes no teal reference — ensures it reads as neutral.

**`button-disabled`**
- Background `{colors.surface-soft}`, text `{colors.disabled-text}`, border `{colors.hairline}`. Cursor `not-allowed`. No teal reference.

### Form Controls

**`text-input`** / **`text-area`** / **`select-input`**
- White background, `{colors.ink}` text, `{colors.hairline-strong}` border, `{rounded.md}` (6px), Inter `{typography.body-md}`.
- Focused: border upgrades to `2px solid {colors.primary}` with focus ring (level-2 shadow). The single most important interactive state — teal border is how the system says "you are here".
- Error: background `{colors.warning-surface}`, border `{colors.warning}`, paired with a `{colors.warning}` caption-md helper text below.

**`toggle-on`** / **`toggle-off`**
- ON: teal track `{colors.primary}`, white knob. OFF: gray track `{colors.ash-light}`, white knob. Pill shape `{rounded.full}`.

**`checkbox-on`** / **`checkbox-off`** / **`radio-on`** / **`radio-off`**
- ON state: teal fill `{colors.primary}` with white check/dot. OFF state: white background, `{colors.hairline-strong}` border. 16×16px, `{rounded.sm}` (checkbox) and `{rounded.full}` (radio).

### Tags & Status Indicators

**`tag-default`** — neutral metadata tag
- Background `{colors.surface-card}`, text `{colors.mute-light}`, type `{typography.label-md}`, pill. Use for categories, stable metadata, version labels.

**`tag-primary`** — active / selected status
- Background `{colors.primary-wash}`, text `{colors.primary-pressed}`, type `{typography.label-md}`, pill. Use for "Active", "Enabled", "Online", selected filter values.

**`tag-warning`** — error / alert status
- Background `{colors.warning-surface}`, text `{colors.warning}`, type `{typography.label-md}`, pill. Use for "Error", "Failed", "Expired".

### Cards

**`card`** — default framed card
- White background, `{colors.hairline}` 1px border, `{rounded.lg}` (12px), 24px padding.

**`card-tinted`** — grouped-content card
- `{colors.surface-card}` fill, no border, `{rounded.lg}` (12px), 24px padding. Use when cards sit on a white section and need grouping without hard-border chrome.

**`card-raised`** — interactive / focused card
- White background, teal-tinted shadow (level 3), `{rounded.lg}` (12px), 24px padding. Use for hovered states, selected cards, and dropdown-menu panels.

### Navigation

**`sidebar-nav`** — left sidebar shell
- `{colors.surface-soft}` fill, 240px wide, full height. No shadow; the page canvas provides depth context at level 0.

**`nav-item`** / **`nav-item-active`**
- Idle: transparent background, `{colors.mute-light}` text, `{rounded.md}` pill, 8/12px padding.
- Active: `{colors.primary-wash}` background, `{colors.primary-pressed}` text, `{typography.body-strong}`. The teal wash is the system's navigation highlight signal — consistent with checkbox, toggle, and selected row tinting.

**`topbar`**
- White background, `{colors.hairline}` bottom border, 56px height. Title in `{typography.heading-md}` `{colors.ink}`. Actions right-aligned: `{components.button-primary}` and `{components.button-ghost}`.

**`tab`** / **`tab-active`**
- Idle: transparent, `{colors.mute-light}` text, 2px transparent bottom border.
- Active: transparent, `{colors.primary}` text, `2px solid {colors.primary}` bottom border. The underline is the tab system's teal signal — consistent with focus rings and interactive state.

### Data Display

**`data-row`** — table body row
- White background, `{colors.hairline}` bottom border, 12px vertical padding.

**`data-row-selected`** — selected table row
- `{colors.primary-wash}` fill, no explicit border needed — the tint is sufficient selection signal at row height.

**`progress-bar-track`** / **`progress-bar-fill`**
- Track: `{colors.hairline}` (6px pill). Fill: `{colors.primary}` — the only surface where teal appears as an area fill rather than a border or text color.

### Feedback & Callouts

**`callout-success`** — teal wash, for completed actions and confirmations.

**`callout-info`** — blue-washed surface, for instructional context.

**`callout-warning`** — red-washed surface, for errors and destructive states.

**`tooltip`** — ink background (`{colors.ink}`), white text, `{typography.caption-sm}`, `{rounded.sm}`, max 240px. Appears on hover only; not a teal element — the high-contrast ink background ensures legibility above both white canvas and teal-tinted surfaces.

### Modals

**`modal`** + **`modal-overlay`**
- Overlay: `rgba(26,31,30,0.45)` — uses `{colors.ink}` base to maintain tonal consistency.
- Panel: white background, `{colors.hairline}` border, `{rounded.xl}` (20px), 32px padding, level-4 shadow, max 520px.
- Always includes a `{components.heading-xl}` title, an action row of `{components.button-primary}` + `{components.button-ghost}`, and optional `{components.divider}` between content and action zones.
