"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Baby,
  Camera,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Clock,
  Globe,
  Link,
  type LucideIcon,
  MapPin,
  Phone,
  Send,
} from "lucide-react";

import { ConfidenceBadge } from "@/components/confidence-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Card, CardField, Contact, ContactChannel } from "@/types";

// ── Channel presentation ────────────────────────────────────
// lucide v1.17 ships no `Instagram` mark; `Camera` stands in for it.
const CHANNEL_ICON: Record<ContactChannel, LucideIcon> = {
  telegram: Send,
  whatsapp: Phone,
  phone: Phone,
  instagram: Camera,
  website: Globe,
};

// ── Deep-link construction (exported for unit tests) ─────────

/** Append a prefilled `text` param only when a draft message exists. */
function withText(base: string, draftMessage: string | undefined): string {
  if (!draftMessage) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}text=${encodeURIComponent(draftMessage)}`;
}

/**
 * Telegram: prefer the t.me https form (opens the app, more reliable across
 * desktops than the tg:// scheme). Strips a leading "@" from the handle.
 */
export function telegramHref(handle: string, draftMessage?: string): string {
  const clean = handle.replace(/^@+/, "").trim();
  return withText(`https://t.me/${clean}`, draftMessage);
}

/** WhatsApp: wa.me with a digits-only number. */
export function whatsappHref(number: string, draftMessage?: string): string {
  const digits = number.replace(/\D/g, "");
  return withText(`https://wa.me/${digits}`, draftMessage);
}

/** Phone: tel: with non-dialable chars stripped (keeps a leading +). */
export function phoneHref(number: string): string {
  const cleaned = number.replace(/[^\d+]/g, "");
  return `tel:${cleaned}`;
}

/** instagram/website handle → external https url. */
function externalHref(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  const handle = value.replace(/^@+/, "").trim();
  // Bare instagram handles resolve under instagram.com; otherwise assume https.
  return value.startsWith("@")
    ? `https://instagram.com/${handle}`
    : `https://${value}`;
}

function truncateUrl(url: string, max = 36): string {
  const stripped = url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return stripped.length > max ? `${stripped.slice(0, max - 1)}…` : stripped;
}

// ── Detail row ──────────────────────────────────────────────
function DetailRow({
  icon: Icon,
  field,
}: {
  icon: LucideIcon;
  field?: CardField<string>;
}) {
  if (!field) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-text">
      <Icon size={14} aria-hidden className="shrink-0 text-muted" />
      <span>{field.value}</span>
      <ConfidenceBadge
        confidence={field.confidence}
        sourceSnippet={field.sourceSnippet}
      />
    </p>
  );
}

// ── Contact row ─────────────────────────────────────────────
function ContactRow({
  contact,
  draftMessage,
}: {
  contact: Contact;
  draftMessage?: string;
}) {
  const { channel, value } = contact;

  let action: { href: string; external: boolean } | null = null;
  if (channel === "telegram") {
    action = { href: telegramHref(value, draftMessage), external: true };
  } else if (channel === "whatsapp") {
    action = { href: whatsappHref(value, draftMessage), external: true };
  }

  let display: { href: string; external: boolean } | null = null;
  if (channel === "phone") {
    display = { href: phoneHref(value), external: false };
  } else if (channel === "instagram" || channel === "website") {
    display = { href: externalHref(value), external: true };
  }

  const ext = { target: "_blank", rel: "noopener noreferrer" } as const;
  const ChannelIcon = CHANNEL_ICON[channel];

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <ChannelIcon size={14} aria-hidden className="shrink-0 text-muted" />
      {display ? (
        <a
          href={display.href}
          {...(display.external ? ext : {})}
          className="text-accent underline-offset-2 hover:underline"
        >
          {value}
        </a>
      ) : (
        <span className="text-text">{value}</span>
      )}
      <ConfidenceBadge confidence={contact.confidence} />
      {action && (
        <a
          href={action.href}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center rounded-pill bg-accent px-3 py-1 text-xs font-medium text-text transition-colors hover:bg-accent-hover"
        >
          Написать
        </a>
      )}
    </div>
  );
}

// ── Draft outreach (collapsible + copy) ─────────────────────
function DraftOutreach({ message }: { message: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — fail quietly.
    }
  }

  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-faint transition-colors hover:text-muted"
      >
        {open ? (
          <ChevronUp size={14} aria-hidden className="shrink-0" />
        ) : (
          <ChevronDown size={14} aria-hidden className="shrink-0" />
        )}
        Готовое сообщение
      </button>
      {open && (
        <div className="mt-2 rounded-card bg-surface-raised p-3">
          <p className="whitespace-pre-wrap text-text">{message}</p>
          <Button
            size="sm"
            variant="ghost"
            onClick={copy}
            className="mt-2 text-accent"
          >
            {copied ? "Скопировано" : "Копировать"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Card ────────────────────────────────────────────────────
export function CandidateCard({ card }: { card: Card }) {
  const {
    name,
    rank,
    district,
    address,
    schedule,
    priceRange,
    ageRange,
    matchReason,
    contacts,
    draftMessage,
    sources,
  } = card;

  const hasLocation = Boolean(district || address);

  // Glass reveal: fade + rise on scroll-into-view, ~0.4s ease-out. Gated on
  // reduced-motion (rendered flat) so we don't animate for users who opt out.
  const reduce = useReducedMotion();

  return (
    <motion.article
      initial={reduce ? false : { opacity: 0, y: 16 }}
      whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className={cn(
        // Translucent glass over the live shader — slightly more opaque than a
        // pure overlay so text stays crisp; blur + faint border give the
        // floating/elevated feel.
        "w-full rounded-card border border-white/5 bg-surface/55 p-5 backdrop-blur-xl",
        "shadow-[0_8px_32px_-12px_rgba(0,0,0,0.5)]",
        "transition-shadow duration-200",
        "hover:shadow-[0_0_40px_-8px_var(--accent-glow)]",
      )}
    >
      {/* Header */}
      <header className="flex items-start gap-2">
        {typeof rank === "number" && (
          <span className="mt-0.5 inline-flex shrink-0 items-center rounded-pill bg-accent-subtle px-2 py-0.5 text-xs font-semibold tabular-nums text-text">
            #{rank}
          </span>
        )}
        <h3 className="text-base font-semibold leading-snug tracking-tight text-text">
          {name}
        </h3>
      </header>

      {/* Location */}
      {hasLocation && (
        <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-sm text-muted">
          <MapPin size={14} aria-hidden className="shrink-0 text-muted" />
          {district && (
            <span className="inline-flex items-center text-text">
              {district.value}
              <ConfidenceBadge
                confidence={district.confidence}
                sourceSnippet={district.sourceSnippet}
              />
            </span>
          )}
          {district && address && <span className="text-faint">·</span>}
          {address && (
            <span className="inline-flex items-center text-text">
              {address.value}
              <ConfidenceBadge
                confidence={address.confidence}
                sourceSnippet={address.sourceSnippet}
              />
            </span>
          )}
        </p>
      )}

      {/* Details */}
      <div className="mt-2 space-y-1">
        <DetailRow icon={Clock} field={schedule} />
        <DetailRow icon={CircleDollarSign} field={priceRange} />
        <DetailRow icon={Baby} field={ageRange} />
      </div>

      {/* Match reason */}
      {matchReason && (
        <p className="mt-3 text-sm italic text-muted">
          Почему подходит: {matchReason}
        </p>
      )}

      {/* Contacts */}
      {contacts.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-border pt-3">
          {contacts.map((contact, i) => (
            <ContactRow
              key={`${contact.channel}-${i}`}
              contact={contact}
              draftMessage={draftMessage}
            />
          ))}
        </div>
      )}

      {/* Draft outreach */}
      {draftMessage && (
        <div className="mt-3">
          <DraftOutreach message={draftMessage} />
        </div>
      )}

      {/* Sources */}
      {sources.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
          <span className="inline-flex items-center gap-1">
            <Link size={12} aria-hidden className="shrink-0" />
            Источники:
          </span>
          {sources.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="max-w-[14rem] truncate underline-offset-2 hover:text-muted hover:underline"
            >
              {truncateUrl(url)}
            </a>
          ))}
        </div>
      )}
    </motion.article>
  );
}

// ── Skeleton ────────────────────────────────────────────────
/**
 * CandidateCardSkeleton — placeholder for a card that exists (name + district
 * came from search) but whose fields are still being enriched by an active run.
 * `name` and `district` render plainly; the not-yet-enriched rows show skeleton
 * lines.
 */
export function CandidateCardSkeleton({
  name,
  district,
}: {
  name?: string;
  district?: string;
} = {}) {
  return (
    <article className="w-full rounded-card border border-white/5 bg-surface/55 p-5 shadow-[0_8px_32px_-12px_rgba(0,0,0,0.5)] backdrop-blur-xl">
      <header className="flex items-start gap-2">
        {name ? (
          <h3 className="text-base font-semibold leading-snug tracking-tight text-text">
            {name}
          </h3>
        ) : (
          <Skeleton className="h-5 w-2/3" />
        )}
      </header>

      <p className="mt-2 flex items-center gap-1.5 text-sm text-muted">
        <MapPin size={14} aria-hidden className="shrink-0 text-muted" />
        {district ? (
          <span className="text-text">{district}</span>
        ) : (
          <Skeleton className="h-4 w-1/3" />
        )}
      </p>

      <div className="mt-3 space-y-2">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-4 w-1/3" />
      </div>

      <div className="mt-4 space-y-2 border-t border-border pt-3">
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-4 w-2/5" />
      </div>
    </article>
  );
}
