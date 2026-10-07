import type { ReactNode } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import { ApiError } from '../api.ts';
import { STATUS_LABELS } from '../format.ts';
import { BannerIcons } from './icons.tsx';

export function ErrorBanner({
  error,
  title = 'Une erreur est survenue',
}: {
  error: unknown;
  title?: string;
}) {
  const message = error instanceof Error ? error.message : 'Erreur inconnue.';
  const correlation = error instanceof ApiError ? error.correlationId : null;
  return (
    <div className="banner banner-error" role="alert">
      {BannerIcons.error}
      <div className="banner-body">
        <strong>{title}</strong>
        <p>{message}</p>
        {correlation && <p className="muted small">Référence de diagnostic : {correlation}</p>}
      </div>
    </div>
  );
}

export function Banner({
  kind,
  children,
}: {
  kind: 'info' | 'warning' | 'success';
  children: ReactNode;
}) {
  return (
    <div className={`banner banner-${kind}`} role={kind === 'warning' ? 'alert' : 'status'}>
      {BannerIcons[kind]}
      <div className="banner-body">{children}</div>
    </div>
  );
}

export function Loading({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="loading-track" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABELS[status] ?? status}</span>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section className="empty" aria-label={title}>
      <Instrument className="instrument-sm" />
      <div>
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  );
}

export function FictionalBadge() {
  return (
    <span
      className="badge badge-fictional"
      title="Données ou règles fictives de démonstration, non validées métier"
    >
      Fictif
    </span>
  );
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="page-head">
      <h1>{title}</h1>
      {children}
    </header>
  );
}

/**
 * Toggle group with a thumb that slides to the pressed option. The thumb is measured
 * from the DOM so it follows wrapping and resizing; without it the pressed option is
 * still styled on its own.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  const groupRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const place = () => {
      const pressed = group.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!pressed) return;
      group.style.setProperty('--thumb-x', `${String(pressed.offsetLeft)}px`);
      group.style.setProperty('--thumb-y', `${String(pressed.offsetTop)}px`);
      group.style.setProperty('--thumb-w', `${String(pressed.offsetWidth)}px`);
      group.style.setProperty('--thumb-h', `${String(pressed.offsetHeight)}px`);
    };
    place();
    // Enable the slide only after the first placement, so the thumb does not fly in.
    const frame = requestAnimationFrame(() => {
      group.dataset.ready = 'true';
    });
    const observer = new ResizeObserver(place);
    observer.observe(group);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [value]);
  return (
    <div ref={groupRef} className="segmented" role="group" aria-label={label}>
      <span className="segmented-thumb" aria-hidden="true" />
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Horizontal scroll container for wide tables. When the table overflows, the container
 * becomes a named, focusable region so keyboard users can scroll it.
 */
export function TableScroll({
  label,
  framed = false,
  children,
}: {
  label: string;
  framed?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    // ResizeObserver reports once on observe, then on every size change.
    const observer = new ResizeObserver(() => {
      setScrollable(element.scrollWidth > element.clientWidth + 1);
    });
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={framed ? 'table-wrap table-framed' : 'table-wrap'}
      role={scrollable ? 'region' : undefined}
      aria-label={scrollable ? label : undefined}
      tabIndex={scrollable ? 0 : undefined}
    >
      {children}
    </div>
  );
}

/** Graduated priority scale (0–100). Decorative: the score is always written next to it. */
export function PriorityGauge({ score, ticks = 20 }: { score: number; ticks?: number }) {
  const lit = Math.round((Math.max(0, Math.min(100, score)) / 100) * ticks);
  return (
    <span className="gauge" aria-hidden="true">
      {Array.from({ length: ticks }, (_, i) => (
        <span
          key={i}
          className={i < lit ? 'gauge-tick is-on' : 'gauge-tick'}
          style={{ '--i': i }}
        />
      ))}
    </span>
  );
}

/** Thin magnitude bar for a ratio in [0, 1]. Decorative: the value is always written next to it. */
export function Meter({ ratio }: { ratio: number }) {
  const percent = Math.round(Math.max(0, Math.min(1, ratio)) * 1000) / 10;
  return (
    <span className="meter" aria-hidden="true">
      <span className="meter-fill" style={{ '--value': `${String(percent)}%` }} />
    </span>
  );
}

const point = (radius: number, degrees: number) => {
  const rad = (degrees * Math.PI) / 180;
  return `${(200 + radius * Math.sin(rad)).toFixed(2)} ${(200 - radius * Math.cos(rad)).toFixed(2)}`;
};
const OUTER_TICKS = Array.from({ length: 120 }, (_, i) => i * 3);
const INNER_TICKS = Array.from({ length: 36 }, (_, i) => i * 10);
const BEARING = 52;

/** Navigation instrument drawn with hairlines: graduated rings and a bearing needle. */
export function Instrument({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`instrument ${className}`}
      viewBox="0 0 400 400"
      aria-hidden="true"
      focusable="false"
    >
      <g className="instrument-outer">
        <circle cx="200" cy="200" r="188" pathLength={1} className="ring" />
        {OUTER_TICKS.map((a) => (
          <line
            key={a}
            x1="200"
            y1="12"
            x2="200"
            y2={a % 30 === 0 ? 32 : a % 15 === 0 ? 25 : 20}
            className={a % 30 === 0 ? 'tick tick-major' : 'tick'}
            transform={`rotate(${String(a)} 200 200)`}
          />
        ))}
      </g>
      <circle cx="200" cy="200" r="140" pathLength={1} className="ring ring-mid" />
      <g className="instrument-inner">
        <circle cx="200" cy="200" r="92" pathLength={1} className="ring" />
        {INNER_TICKS.map((a) => (
          <line
            key={a}
            x1="200"
            y1="108"
            x2="200"
            y2={a % 90 === 0 ? 120 : 114}
            className="tick"
            transform={`rotate(${String(a)} 200 200)`}
          />
        ))}
      </g>
      <path
        className="instrument-arc"
        d={`M ${point(164, BEARING - 9)} A 164 164 0 0 1 ${point(164, BEARING + 9)}`}
      />
      <g className="instrument-needle" style={{ '--bearing': `${String(BEARING)}deg` }}>
        <line x1="200" y1="200" x2="200" y2="44" className="needle" />
        <circle cx="200" cy="44" r="5" className="needle-tip" />
      </g>
      <circle cx="200" cy="200" r="4.5" className="hub" />
    </svg>
  );
}
