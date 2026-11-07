import React from 'react';

export interface BrandMarkProps {
  size?: number;
  className?: string;
}

/**
 * Owner-supplied OsmiumIDE mark. The stroke uses `currentColor` so it inverts
 * with the theme; the core uses the logo-only `--brand-mark-accent` token.
 * This is a brand asset, not part of the 24px Icon family.
 */
export const BrandMark: React.FC<BrandMarkProps> = ({ size = 22, className = '' }) => (
  <svg
    viewBox="0 0 120 120"
    width={size}
    height={size}
    aria-hidden="true"
    focusable="false"
    className={`app-brand-mark-svg ${className}`.trim()}
  >
    <g fill="none" stroke="currentColor" strokeWidth={11} strokeLinejoin="miter">
      <path d="M28.82 32L60 14L91.18 32" />
      <path d="M99.84 47V83L68.66 101" />
      <path d="M51.34 101L20.16 83V47" />
    </g>
    <path
      d="M60 47.5L70.83 53.75V66.25L60 72.5L49.17 66.25V53.75Z"
      fill="var(--brand-mark-accent)"
    />
  </svg>
);
