// The app's icons: one stroke family, drawn here so no text glyph stands in
// for an icon. Imported by any component that shows one. Reads and writes
// nothing. Paths match the approved comps (design/comps/build.mjs).

const PATHS = {
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4-4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  rooms: (
    <>
      <circle cx="8" cy="9" r="3" />
      <circle cx="16.5" cy="9" r="3" />
      <path d="M3 19c.8-3 2.8-4.5 5-4.5s4.2 1.5 5 4.5M12.5 15.2c1-.5 2.4-.7 4-.7 2.2 0 4.2 1.5 5 4.5" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
    </>
  ),
  panel: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M14.5 4.5v15" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="18.5" cy="12" r="1.2" />
    </>
  ),
  chev: <path d="m7 10 5 5 5-5" />,
  chevRight: <path d="m10 7 5 5-5 5" />,
  file: (
    <>
      <path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z" />
      <path d="M14 3.5V8h4.5" />
    </>
  ),
  edit: <path d="M4 20h4L19 9l-4-4L4 16z" />,
  term: <path d="m5 8 4 4-4 4M11 17h8" />,
  send: <path d="M12 19V5M6 11l6-6 6 6" />,
  folder: <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  at: (
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M15.5 12v1.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.4 6.8" />
    </>
  ),
  back: <path d="m14 6-6 6 6 6" />,
  shield: <path d="M12 3.5 5 6v5.5c0 4.2 3 7.5 7 9 4-1.5 7-4.8 7-9V6z" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  cross: <path d="M6 6l12 12M18 6 6 18" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  play: <path d="M8 5.5v13l10-6.5z" />,
  archive: <path d="M4 5h16v4H4zM5.5 9v10h13V9M10 13h4" />,
  think: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

/** The CUE triangle: filled, since it is the strongest mark in the app. */
export function CueMark() {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M5 1 9.5 9h-9z" fill="currentColor" />
    </svg>
  );
}
