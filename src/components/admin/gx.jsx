import { useState } from 'react';

/**
 * Small UI kit shared by the GOODEX delivery and claims screens, so every button, alert and
 * date looks the same. Styles live in admin.css under the `gx-` prefix and reuse the admin
 * brand colour (--color-primary).
 */

const ICONS = {
  refresh: ['M21 12a9 9 0 1 1-2.64-6.36', 'M21 3v6h-6'],
  plus: ['M12 5v14', 'M5 12h14'],
  x: ['M18 6 6 18', 'M6 6l12 12'],
  copy: ['M9 9h10v10H9z', 'M5 15V5h10'],
  check: ['M20 6 9 17l-5-5'],
  down: ['M6 9l6 6 6-6'],
  truck: ['M1 4h13v11H1z', 'M14 8h5l3 3v4h-8z', 'M5.5 18.5a1.5 1.5 0 1 0 0 .01', 'M18.5 18.5a1.5 1.5 0 1 0 0 .01'],
  link: ['M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1', 'M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14', 'M21 21l-5-5'],
  eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z', 'M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5'],
};

export function GxIcon({ name, size = 15 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="gx-icon"
    >
      {(ICONS[name] || []).map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

/** variant: default (outline) | primary (brand) | danger (outline red) | ghost (text only) */
export function GxButton({ variant = 'default', icon, busy = false, children, className = '', disabled, ...props }) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || busy}
      className={`gx-btn gx-btn--${variant}${busy ? ' is-busy' : ''}${className ? ` ${className}` : ''}`}
    >
      {busy ? <span className="gx-spinner" aria-hidden="true" /> : icon && <GxIcon name={icon} />}
      <span>{children}</span>
    </button>
  );
}

/** Copies a value (e.g. an EAN) to the clipboard and confirms briefly. */
export function CopyButton({ text, label = 'Copier' }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (insecure context): nothing to do */
    }
  };
  return (
    <button type="button" className="gx-copy" onClick={copy} title={`${label} ${text}`} aria-label={`${label} ${text}`}>
      <GxIcon name={copied ? 'check' : 'copy'} size={13} />
      <span>{copied ? 'Copié' : label}</span>
    </button>
  );
}

/** tone: error | warn | info | ok */
export function Alert({ tone = 'info', title, children }) {
  return (
    <div className={`gx-alert gx-alert--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {title && <strong className="gx-alert__title">{title}</strong>}
      <div className="gx-alert__body">{children}</div>
    </div>
  );
}

/**
 * Human date for GOODEX / Silky timestamps. ISO strings with a zone (2026-10-26T09:12:44.000000Z)
 * become local "26/10/2026 10:12"; zone-less "YYYY-MM-DD HH:MM:SS" (the parcel's created_at) are
 * reformatted without any time-zone guess; anything else is shown as received.
 */
export function formatGoodexDate(value) {
  if (!value || typeof value !== 'string') return '';
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  }
  const plain = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(value);
  if (plain) return `${plain[3]}/${plain[2]}/${plain[1]} ${plain[4]}:${plain[5]}`;
  return value;
}

/** A dt/dd pair; renders nothing when there is no value. */
export function KV({ label, children }) {
  if (children === null || children === undefined || children === false || children === '') return null;
  return (
    <div className="gx-kv__row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
