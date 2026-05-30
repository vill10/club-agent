# impeccable — design rules in effect

The durable design rules this project already follows. `DESIGN.md` is the token
source of truth (and `app/globals.css` the live values); this file is the short
list of disciplines those tokens enforce. When a choice isn't covered by a token,
default to the rule that keeps the interface quiet and warm.

1. **OKLCH only.** Every color is authored in OKLCH. No hex, no HSL, no RGB in
   component code.
2. **No pure black or white.** The darkest background and the lightest text both
   carry the violet hue (290). Pure `#000`/`#fff` are off-limits.
3. **Single accent, used sparingly.** Violet is the only accent. It marks action,
   activity, and links — and covers roughly 10% of any screen at most. If violet
   is everywhere, it means nothing.
4. **7-step spacing scale.** Use 8 / 16 / 24 / 32 / 48 / 80 / 120 px. The 4px step
   is intentionally omitted; don't reach for it.
5. **3-step radius scale.** Pills (9999px) for chips and tags, 14px for cards and
   panels, 10px for buttons and inputs. Nothing else.
6. **Animate transform and opacity only.** No animating layout, color, or size.
   This keeps motion cheap and smooth.
7. **3 named easings.** ease-out for entrances, ease-in-out for state changes,
   ease-in for exits. No bounce, no spring.
8. **prefers-reduced-motion is mandatory.** Every animated element honors
   `prefers-reduced-motion: reduce`. This is not optional.
9. **Soft glows over hard borders.** Prefer a soft, violet-tinted glow
   (`accent-glow`) to convey elevation. Borders are hairlines, used sparingly.
10. **Dark-first.** The dark theme is the design. Build and review there first.
