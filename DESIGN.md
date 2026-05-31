# Club Agent — Design Contract

The locked visual identity. `app/globals.css` is the single source of truth for the
actual token values; this file is the human + agent readable contract they must match.

```yaml
direction: linear-dark · near-neutral surfaces · violet accent

color:
  # OKLCH, dark theme — Linear-style: near-neutral surfaces (faint cool hue
  # 270), violet is the ONLY saturated color. Never pure black / white.
  bg:             oklch(0.155 0.004 270)  # app background
  surface:        oklch(0.195 0.005 270)  # cards, panels
  surface-raised: oklch(0.235 0.006 270)  # popovers, modals
  border:         oklch(0.275 0.006 270)  # hairlines, sparing
  text:           oklch(0.97 0.003 270)   # primary text (near-white)
  text-muted:     oklch(0.72 0.006 270)   # secondary
  text-faint:     oklch(0.55 0.006 270)   # dim rows, timestamps
  accent:         oklch(0.62 0.22 300)    # primary buttons, active, links (punched violet)
  accent-hover:   oklch(0.68 0.22 300)
  accent-subtle:  oklch(0.30 0.10 300)    # tinted bg, active chip fill
  accent-glow:    oklch(0.62 0.22 300 / 0.30)  # soft elevation
  success:        oklch(0.72 0.15 150)
  warning:        oklch(0.80 0.13 75)
  error:          oklch(0.66 0.20 25)

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

Club Agent is **Linear-dark, near-neutral, violet**. The interface lives in a deep
near-neutral dark (every grey carries only a faint cool hue of 270 so the surface reads
as a true neutral dark, not a tint) and leans on a single saturated violet accent — the
only saturated color in the system — to mark action, activity, and links. Restraint over
decoration: violet pops precisely because nothing else competes with it. Warmth comes from geometric humanist type
(Plus Jakarta Sans) and generously rounded corners (the 10–14px radii and full pills)
rather than from color clutter. Motion is quiet and purposeful: transform/opacity only,
no bounce, and fully neutralized for anyone who asks for reduced motion.
