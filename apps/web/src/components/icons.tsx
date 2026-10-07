import type { ReactNode } from 'react';

/** Decorative line icons (1.4px stroke, currentColor). Always hidden from assistive technology. */
function Icon({ children, className = 'icon' }: { children: ReactNode; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Ulysse mark: a graduated bearing ring with its needle. */
export function BrandMark() {
  const ticks = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10.25" fill="none" stroke="currentColor" strokeWidth="1.1" />
      {ticks.map((angle) => (
        <line
          key={angle}
          x1="12"
          y1="2.6"
          x2="12"
          y2={angle % 90 === 0 ? 5.2 : 4}
          stroke="currentColor"
          strokeWidth="1"
          transform={`rotate(${String(angle)} 12 12)`}
        />
      ))}
      <path d="M12 12 L16.6 7.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    </svg>
  );
}

export const NavIcons: Record<string, ReactNode> = {
  '/recommendations': (
    <Icon>
      <circle cx="10" cy="10" r="7" />
      <path d="M12.8 7.2 11 11 7.2 12.8 9 9z" />
    </Icon>
  ),
  '/opportunities': (
    <Icon>
      <path d="m10 3.5 6.5 3.25L10 10 3.5 6.75z" />
      <path d="m3.5 10.25 6.5 3.25 6.5-3.25" />
      <path d="m3.5 13.5 6.5 3.25 6.5-3.25" />
    </Icon>
  ),
  '/connections': (
    <Icon>
      <path d="M8.5 11.5a3 3 0 0 0 4.24 0l2.5-2.5a3 3 0 0 0-4.24-4.24l-.75.75" />
      <path d="M11.5 8.5a3 3 0 0 0-4.24 0l-2.5 2.5a3 3 0 0 0 4.24 4.24l.75-.75" />
    </Icon>
  ),
  '/measure': (
    <Icon>
      <path d="M4 16.5h12" />
      <path d="M6 13.5v-3" />
      <path d="M10 13.5v-8" />
      <path d="M14 13.5v-5" />
    </Icon>
  ),
  '/history': (
    <Icon>
      <path d="M3.6 10a6.4 6.4 0 1 0 1.9-4.55" />
      <path d="M3.5 3.5v2.4h2.4" />
      <path d="M10 6.75V10l2.25 1.5" />
    </Icon>
  ),
  '/admin': (
    <Icon>
      <path d="M3.5 6.5h7M14.5 6.5h2" />
      <circle cx="12.5" cy="6.5" r="1.75" />
      <path d="M3.5 13.5h2M9.5 13.5h7" />
      <circle cx="7.5" cy="13.5" r="1.75" />
    </Icon>
  ),
};

export function ChevronLeft() {
  return (
    <Icon className="icon icon-sm">
      <path d="m12 4.5-5.5 5.5 5.5 5.5" />
    </Icon>
  );
}

export function ChevronRight() {
  return (
    <Icon className="icon icon-sm">
      <path d="m8 4.5 5.5 5.5L8 15.5" />
    </Icon>
  );
}

export function LogoutIcon() {
  return (
    <Icon className="icon icon-sm">
      <path d="M8 4.5H5.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1H8" />
      <path d="M11.5 13.5 15 10l-3.5-3.5M15 10H8" />
    </Icon>
  );
}

export const BannerIcons: Record<'info' | 'warning' | 'success' | 'error', ReactNode> = {
  info: (
    <Icon className="icon banner-icon">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 9v4.5M10 6.6v.01" />
    </Icon>
  ),
  warning: (
    <Icon className="icon banner-icon">
      <path d="M10 3.5 17 16H3z" />
      <path d="M10 8.5v3.5M10 14.1v.01" />
    </Icon>
  ),
  success: (
    <Icon className="icon banner-icon">
      <circle cx="10" cy="10" r="7" />
      <path className="check-path" d="m6.8 10.2 2.2 2.2 4.2-4.6" />
    </Icon>
  ),
  error: (
    <Icon className="icon banner-icon">
      <circle cx="10" cy="10" r="7" />
      <path d="m7.6 7.6 4.8 4.8M12.4 7.6l-4.8 4.8" />
    </Icon>
  ),
};
