# Club Agent — Design Contract

The locked visual identity. `app/globals.css` is the single source of truth for the
actual token values; this file is the human + agent readable contract they must match.

```yaml
direction: warm-minimal · dark-first · violet

color:
  # OKLCH, dark theme — never pure black / white
  bg:             oklch(0.18 0.02 290)    # app background
  surface:        oklch(0.22 0.025 290)   # cards, panels
  surface-raised: oklch(0.26 0.03 290)    # popovers, modals
  border:         oklch(0.32 0.02 290)    # hairlines, sparing
  text:           oklch(0.96 0.01 290)    # primary text
  text-muted:     oklch(0.72 0.015 290)   # secondary
  text-faint:     oklch(0.55 0.015 290)   # dim rows, timestamps
  accent:         oklch(0.62 0.19 295)    # primary buttons, active, links
  accent-hover:   oklch(0.68 0.19 295)
  accent-subtle:  oklch(0.30 0.08 295)    # tinted bg, active chip fill
  accent-glow:    oklch(0.62 0.19 295 / 0.25)  # soft elevation
  success:        oklch(0.70 0.15 150)
  warning:        oklch(0.78 0.14 75)
  error:          oklch(0.65 0.18 25)

typography:
  family: Plus Jakarta Sans   # via next/font/google
  headings:
    weight: 600-700
    tracking: -0.01em to -0.02em
  body:
    weight: 400-500
    line-height: 1.6
  numbers: tabular-nums where numbers are shown

spacing:
  # 7-step scale (px). The 4px step is intentionally omitted.
  scale: [8, 16, 24, 32, 48, 80, 120]

radius:
  # the warmth lever
  pill:    9999px   # chips / tags
  card:    14px     # cards / panels
  control: 10px     # buttons / inputs

motion:
  properties: [transform, opacity]   # only these
  reduced-motion: honor prefers-reduced-motion:reduce
  easings:
    entrances: ease-out
    state-changes: ease-in-out
    exits: ease-in
  no-bounce: true
```

## Rationale

Club Agent is **warm-minimal, dark-first, violet**. The interface lives in a dark,
violet-tinted neutral (every grey carries a hue of 290 so the surface never reads as
clinical black) and leans on a single saturated violet accent to mark action, activity,
and links — restraint over decoration. Warmth comes from geometric humanist type
(Plus Jakarta Sans) and generously rounded corners (the 10–14px radii and full pills)
rather than from color clutter. Motion is quiet and purposeful: transform/opacity only,
no bounce, and fully neutralized for anyone who asks for reduced motion.
