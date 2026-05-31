"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

// A premium "liquid glass" button: a translucent control with a layered glass
// shadow and an SVG displacement filter applied via `backdropFilter`. Extracted
// clean from the original messy drop (which exported before declaring its
// consts and bundled an unused MetalButton). Exports live at the END.

const liquidbuttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-base font-medium text-text transition-all duration-300 ease-out [-webkit-tap-highlight-color:transparent] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
  {
    variants: {
      size: {
        default: "h-11 px-6 [&_svg:not([class*='size-'])]:size-5",
        sm: "h-9 px-4 text-sm [&_svg:not([class*='size-'])]:size-4",
        lg: "h-12 px-8 [&_svg:not([class*='size-'])]:size-6",
        xl: "h-14 px-10 text-lg [&_svg:not([class*='size-'])]:size-7",
        icon: "size-11",
        "icon-xl": "size-14 [&_svg:not([class*='size-'])]:size-6",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

function LiquidButton({
  className,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof liquidbuttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="liquid-button"
      className={cn(
        "relative",
        liquidbuttonVariants({ size }),
        // Layered glass shadow: inner highlight + soft violet-tinted lift.
        "shadow-[0_2px_8px_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.08),0_0_20px_-8px_var(--accent-glow)]",
        "hover:shadow-[0_4px_14px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.12),0_0_28px_-6px_var(--accent-glow)]",
        "active:translate-y-px",
        className,
      )}
      {...props}
    >
      {/* Glass body: translucent surface tint sitting under the content. */}
      <span
        className="pointer-events-none absolute inset-0 rounded-full bg-accent/80"
        aria-hidden="true"
      />
      {/* Liquid distortion layer — applies the SVG displacement filter. */}
      <span
        className="pointer-events-none absolute inset-0 rounded-full"
        aria-hidden="true"
        style={{
          backdropFilter: "url(#container-glass)",
          WebkitBackdropFilter: "url(#container-glass)",
        }}
      />
      <span className="relative z-10 inline-flex items-center justify-center gap-2">
        {props.children}
      </span>
      <GlassFilter />
    </Comp>
  );
}

// SVG displacement filter referenced by the button's backdropFilter. Rendered
// once per button; zero-size + absolutely positioned so it never affects layout.
function GlassFilter() {
  return (
    <svg
      className="pointer-events-none absolute -z-10 h-0 w-0"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <filter
          id="container-glass"
          x="0%"
          y="0%"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.05 0.05"
            numOctaves="1"
            seed="1"
            result="turbulence"
          />
          <feGaussianBlur in="turbulence" stdDeviation="2" result="blurred" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="blurred"
            scale="40"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}

export { LiquidButton, liquidbuttonVariants };
