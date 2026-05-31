import type { CSSProperties } from "react";

/**
 * FrostedText — TRUE frosted-glass letters.
 *
 * Renders a backdrop-blur layer that is MASKED to the shape of the glyphs via
 * an inline SVG `<text>` data-URI. The result: where the letters are, the
 * animated beam behind the page shows through BLURRED + faintly frosted; outside
 * the letters there is no blur and no box — fully transparent.
 *
 * `background-clip: text` cannot clip `backdrop-filter`, so a glyph-shaped mask
 * is the only robust technique. The SVG uses the same font family
 * (Plus Jakarta Sans), weight, and is laid out with a viewBox so it scales
 * responsively with its container.
 *
 * The real text stays in the DOM (sr-only, supplied by the caller) for a11y/SEO;
 * this element is decorative and aria-hidden.
 */

type FrostedTextProps = {
  text: string;
  /** font-size in the SVG user space (relative units; the viewBox scales it). */
  fontSize: number;
  fontWeight: number;
  /** SVG letter-spacing in user units. */
  letterSpacing?: number;
  /** backdrop blur radius in px. */
  blur?: number;
  /** translucent frost-tint fill alpha (0..1). */
  tintAlpha?: number;
  /** thin glyph-edge stroke alpha for legibility on bright beam areas (0..1). */
  strokeAlpha?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
};

// Approximate per-glyph advance to size the SVG viewBox so the mask hugs the
// text box (mask-size: contain keeps the aspect ratio; the box just needs the
// right proportions). Width is generous; SVG text is centered.
function buildMaskSvg({
  text,
  fontSize,
  fontWeight,
  letterSpacing,
  strokeAlpha,
  strokeWidth,
}: {
  text: string;
  fontSize: number;
  fontWeight: number;
  letterSpacing: number;
  strokeAlpha: number;
  strokeWidth: number;
}): { svg: string; width: number; height: number } {
  // Rough advance width: 0.62em per char for this font at extrabold, plus the
  // letter-spacing. Generous padding avoids clipping ascenders/descenders.
  const width = Math.ceil(text.length * fontSize * 0.62 + letterSpacing * text.length + fontSize);
  const height = Math.ceil(fontSize * 1.35);
  const baseline = Math.round(height * 0.72);
  const stroke =
    strokeAlpha > 0
      ? ` stroke="rgba(255,255,255,${strokeAlpha})" stroke-width="${strokeWidth}"`
      : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet"><text x="50%" y="${baseline}" text-anchor="middle" font-family="'Plus Jakarta Sans', system-ui, sans-serif" font-weight="${fontWeight}" font-size="${fontSize}" letter-spacing="${letterSpacing}" fill="#fff"${stroke}>${escapeXml(
    text,
  )}</text></svg>`;

  return { svg, width, height };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function FrostedText({
  text,
  fontSize,
  fontWeight,
  letterSpacing = 0,
  blur = 12,
  tintAlpha = 0.06,
  strokeAlpha = 0.28,
  strokeWidth = 0.6,
  className,
  style,
}: FrostedTextProps) {
  const { svg, width, height } = buildMaskSvg({
    text,
    fontSize,
    fontWeight,
    letterSpacing,
    strokeAlpha,
    strokeWidth,
  });
  const dataUri = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;

  const maskStyle: CSSProperties = {
    // Keep the element proportioned to the text box so `contain` aligns the
    // glyph mask precisely; the container width drives responsive scaling.
    aspectRatio: `${width} / ${height}`,
    WebkitBackdropFilter: `blur(${blur}px)`,
    backdropFilter: `blur(${blur}px)`,
    background: `rgba(255,255,255,${tintAlpha})`,
    WebkitMaskImage: dataUri,
    maskImage: dataUri,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskSize: "contain",
    maskSize: "contain",
    // Soft glow so the frosted glyphs read against bright beam areas without
    // turning the glass opaque.
    filter:
      "drop-shadow(0 1px 2px rgba(0,0,0,0.55)) drop-shadow(0 0 18px color-mix(in oklch, var(--accent-glow) 50%, transparent))",
    ...style,
  };

  return <div aria-hidden className={className} style={maskStyle} />;
}
