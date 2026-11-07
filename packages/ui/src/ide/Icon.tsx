import React from 'react';

/**
 * One icon family: 24px grid, 1.6 stroke, round caps and joins.
 * Drawn here so every control in the workbench shares the same weight.
 */
const PATHS = {
  sidebarLeft: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  sidebarRight: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M14.5 4.5v15" />
    </>
  ),
  panelBottom: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M3.5 14.5h17" />
    </>
  ),
  folder: (
    <path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2.2h7.2a2 2 0 0 1 2 2v7.3a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  ),
  folderOpen: (
    <path d="M3.5 8V7.5a2 2 0 0 1 2-2h3.8l2 2.2h6.2a2 2 0 0 1 2 2V10M3.8 18.5l1.9-7.2a1.6 1.6 0 0 1 1.5-1.2h13.3a1 1 0 0 1 1 1.3l-1.8 6.1a2 2 0 0 1-1.9 1.4H5.5a1.7 1.7 0 0 1-1.7-.4z" />
  ),
  file: (
    <>
      <path d="M13.5 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8.5z" />
      <path d="M13.5 3.5v4a1 1 0 0 0 1 1h4" />
    </>
  ),
  filePlus: (
    <>
      <path d="M13.5 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8.5z" />
      <path d="M13.5 3.5v4a1 1 0 0 0 1 1h4M12 11.5v5M9.5 14h5" />
    </>
  ),
  folderPlus: (
    <>
      <path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2.2h7.2a2 2 0 0 1 2 2v7.3a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
      <path d="M12 10.8v4.4M9.8 13h4.4" />
    </>
  ),
  chevronRight: <path d="M9.5 6l6 6-6 6" />,
  chevronDown: <path d="M6 9.5l6 6 6-6" />,
  chevronUp: <path d="M6 14.5l6-6 6 6" />,
  chevronUpDown: <path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4" />,
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="M15.6 15.6l4.4 4.4" />
    </>
  ),
  branch: (
    <>
      <circle cx="6.5" cy="5.5" r="2.2" />
      <circle cx="6.5" cy="18.5" r="2.2" />
      <circle cx="17.5" cy="8.5" r="2.2" />
      <path d="M6.5 7.7v8.6M17.5 10.7c0 4-4.4 4.7-8.8 5.6" />
    </>
  ),
  play: <path d="M8 5.8v12.4a.8.8 0 0 0 1.2.7l10-6.2a.8.8 0 0 0 0-1.4l-10-6.2A.8.8 0 0 0 8 5.8z" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2" />,
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  minus: <path d="M5.5 12h13" />,
  x: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  xCircle: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" />
    </>
  ),
  check: <path d="M5.5 12.5l4.2 4.2L18.5 7.8" />,
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12.3l2.5 2.5 4.6-5" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 4.9L3.7 16.4A2 2 0 0 0 5.4 19.4h13.2a2 2 0 0 0 1.7-3L13.7 4.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.8v3.7M12 16.4v.1" />
    </>
  ),
  terminal: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M7.5 9.5l3 2.5-3 2.5M12.5 14.5h4" />
    </>
  ),
  sparkle: (
    <>
      <path d="M11 4.5c.5 3.6 2.4 5.5 6 6-3.6.5-5.5 2.4-6 6-.5-3.6-2.4-5.5-6-6 3.6-.5 5.5-2.4 6-6z" />
      <path d="M18 15.5c.2 1.4.9 2.1 2.3 2.3-1.4.2-2.1.9-2.3 2.3-.2-1.4-.9-2.1-2.3-2.3 1.4-.2 2.1-.9 2.3-2.3z" />
    </>
  ),
  ellipsis: (
    <>
      <circle cx="6" cy="12" r=".6" />
      <circle cx="12" cy="12" r=".6" />
      <circle cx="18" cy="12" r=".6" />
    </>
  ),
  refresh: <path d="M19.5 11.5a7.5 7.5 0 1 0-2 5.2M19.5 5.5v4.5H15" />,
  arrowUp: <path d="M12 18.5v-13M6.5 11l5.5-5.5 5.5 5.5" />,
  paperclip: (
    <path d="M19.5 11.2l-7.3 7.3a4.6 4.6 0 0 1-6.5-6.5l7.6-7.6a3 3 0 0 1 4.3 4.3l-7.6 7.6a1.5 1.5 0 0 1-2.1-2.1l7-7" />
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="3.8" />
      <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18" />
    </>
  ),
  moon: <path d="M19.5 14.2A7.8 7.8 0 0 1 9.8 4.5a7.8 7.8 0 1 0 9.7 9.7z" />,
  trash: (
    <path d="M5 7.5h14M9.5 7.5V5.5h5v2M7 7.5l.8 11a1.5 1.5 0 0 0 1.5 1.4h5.4a1.5 1.5 0 0 0 1.5-1.4l.8-11M10.3 11v5.5M13.7 11v5.5" />
  ),
  pencil: (
    <path d="M4.5 19.5l.9-3.9L15.8 5.2a2 2 0 0 1 2.9 0l.1.1a2 2 0 0 1 0 2.9L8.4 18.6z M14.3 6.8l2.9 2.9" />
  ),
  layers: (
    <>
      <path d="M12 3.8l8.2 4.3L12 12.4 3.8 8.1z" />
      <path d="M3.8 12.1l8.2 4.3 8.2-4.3M3.8 16l8.2 4.3L20.2 16" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5v-1a2 2 0 0 0-2-2h-6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h1" />
    </>
  ),
  tool: (
    <path d="M14.5 6.3a4 4 0 0 0 4.9 4.9l-8.6 8.6a2.1 2.1 0 0 1-3-3l8.6-8.6zM14.5 6.3l2.2-2.2" />
  ),
  circleDot: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
    </>
  ),
  command: (
    <path d="M9 9V6.5A2.5 2.5 0 1 0 6.5 9H9zm0 0h6m-6 0v6m6-6V6.5A2.5 2.5 0 1 1 17.5 9H15zm0 0v6m0 0h2.5a2.5 2.5 0 1 1-2.5 2.5V15zm0 0H9m0 0H6.5A2.5 2.5 0 1 0 9 17.5V15z" />
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.5v2.4M12 18.1v2.4M3.5 12h2.4M18.1 12h2.4M6 6l1.7 1.7M16.3 16.3L18 18M18 6l-1.7 1.7M7.7 16.3L6 18" />
    </>
  ),
  message: (
    <path d="M4.5 5.5a1.5 1.5 0 0 1 1.5-1.5h12a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-4.5 4z" />
  ),
  code: <path d="M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5" />,
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19.5c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5M16 5.6a3.2 3.2 0 0 1 0 5.8M17.5 15.3c1.6.6 2.6 1.9 3 4.2" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  square: <rect x="5" y="5" width="14" height="14" rx="1.5" />,
  restore: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="1.5" />
      <path d="M5 15.5h-0.5v-10a1.5 1.5 0 0 1 1.5-1.5h10" />
    </>
  ),
  bot: (
    <>
      <rect x="4.5" y="8" width="15" height="11" rx="2.5" />
      <path d="M12 8V4.5M12 4.5h.01" />
      <path d="M9 13.5h.01M15 13.5h.01" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export interface IconProps extends Omit<React.SVGAttributes<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  strokeWidth?: number;
}

export const Icon: React.FC<IconProps> = ({
  name,
  size = 16,
  strokeWidth = 1.6,
  className = '',
  ...rest
}) => {
  const filled = name === 'play' || name === 'stop';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`os-icon ${className}`.trim()}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
};
