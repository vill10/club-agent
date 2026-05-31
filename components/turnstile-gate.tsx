"use client";

import Script from "next/script";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

// Cloudflare ALWAYS-PASS test sitekey — public, not a secret. Lets dev work
// without a real key configured.
const TURNSTILE_TEST_SITEKEY = "1x00000000000000000000AA";
const SITEKEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || TURNSTILE_TEST_SITEKEY;

// Minimal surface of the Cloudflare Turnstile global we use.
interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
      "timeout-callback"?: () => void;
      theme?: "auto" | "light" | "dark";
      // "interaction-only" keeps the widget HIDDEN for normal users (a token
      // is still issued silently); it only renders a visible challenge if
      // Cloudflare decides an interactive solve is required.
      appearance?: "always" | "execute" | "interaction-only";
      size?: "normal" | "compact" | "flexible";
    },
  ) => string;
  reset: (widgetId?: string) => void;
  getResponse: (widgetId?: string) => string | undefined;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export interface TurnstileGateHandle {
  /**
   * Resolve a FRESH, single-use Turnstile token. Tokens are single-use and
   * short-lived, so this resets the widget and waits for the next solve before
   * resolving — guaranteeing the token handed to /api/runs was just issued.
   * Rejects if the widget errors or no fresh token arrives in time.
   */
  getFreshToken: () => Promise<string>;
}

/**
 * Page-level Turnstile widget that stays mounted across the query → chips
 * steps. Both steps share one widget; the run step requests a freshly-issued
 * token at confirm time via the imperative `getFreshToken()` handle.
 */
export const TurnstileGate = forwardRef<TurnstileGateHandle>(
  function TurnstileGate(_props, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const tokenRef = useRef<string>("");
    // Pending getFreshToken() resolver, awaiting the next solve callback.
    const pendingRef = useRef<{
      resolve: (token: string) => void;
      reject: (err: Error) => void;
    } | null>(null);

    const settlePending = useCallback(
      (token: string | null, err?: Error) => {
        const pending = pendingRef.current;
        if (!pending) return;
        pendingRef.current = null;
        if (token) pending.resolve(token);
        else pending.reject(err ?? new Error("turnstile_failed"));
      },
      [],
    );

    const renderWidget = useCallback(() => {
      if (!window.turnstile || !containerRef.current || widgetIdRef.current) {
        return;
      }
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: SITEKEY,
        theme: "dark",
        // Hidden unless Cloudflare requires an interactive challenge. Token is
        // still issued silently for normal users, so getFreshToken() works.
        appearance: "interaction-only",
        size: "flexible",
        callback: (token) => {
          tokenRef.current = token;
          // A fresh solve just landed — fulfil any waiting getFreshToken().
          settlePending(token);
        },
        "expired-callback": () => {
          tokenRef.current = "";
        },
        "error-callback": () => {
          tokenRef.current = "";
          settlePending(null, new Error("turnstile_error"));
        },
        "timeout-callback": () => {
          settlePending(null, new Error("turnstile_timeout"));
        },
      });
    }, [settlePending]);

    // If the script is already present (e.g. client nav), render immediately.
    useEffect(() => {
      if (window.turnstile) renderWidget();
    }, [renderWidget]);

    useImperativeHandle(
      ref,
      () => ({
        getFreshToken: () =>
          new Promise<string>((resolve, reject) => {
            // Without the script (e.g. blocked) there is no widget. Under the
            // dev-bypass test sitekey the server accepts any token, so fall
            // back to an existing token or a placeholder so dev still works.
            if (!window.turnstile || !widgetIdRef.current) {
              if (tokenRef.current) return resolve(tokenRef.current);
              return resolve("dev");
            }

            // Reject any previously-queued waiter — only one outstanding
            // request at a time.
            if (pendingRef.current) {
              pendingRef.current.reject(new Error("superseded"));
            }
            pendingRef.current = { resolve, reject };

            // Reset clears the spent token and re-runs the challenge; the
            // solve fires `callback`, which settles this promise with a
            // brand-new token. Guard with a timeout so we never hang the UI.
            tokenRef.current = "";
            window.turnstile.reset(widgetIdRef.current);

            const timer = setTimeout(() => {
              settlePending(null, new Error("turnstile_timeout"));
            }, 15000);
            const original = pendingRef.current;
            const wrap = (fn: (arg: string) => void) => (arg: string) => {
              clearTimeout(timer);
              fn(arg);
            };
            pendingRef.current = {
              resolve: wrap(original.resolve),
              reject: (err) => {
                clearTimeout(timer);
                original.reject(err);
              },
            };
          }),
      }),
      [settlePending],
    );

    return (
      <>
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
          onLoad={renderWidget}
        />
        {/* No reserved height / border / bg: under interaction-only the widget
            is hidden for normal users, so the container collapses to nothing
            (it only expands if Cloudflare injects a visible challenge). */}
        <div ref={containerRef} />
      </>
    );
  },
);
