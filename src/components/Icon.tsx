import type { SVGProps } from 'react';

export type IconName =
  | 'spark' | 'sun' | 'check' | 'calendar' | 'bell' | 'mic' | 'send' | 'clock' | 'user' | 'briefcase'
  | 'run' | 'cart' | 'heart' | 'home' | 'flag' | 'trash' | 'x' | 'play' | 'link' | 'arrow' | 'list' | 'doc';

const PATHS: Record<IconName, string> = {
  spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zm7 12l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z',
  sun: 'M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7 1.4-1.4M4.9 19.1l1.4-1.4m0-11.4L4.9 4.9m14.2 14.2-1.4-1.4M12 8a4 4 0 100 8 4 4 0 000-8z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  calendar: 'M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z',
  bell: 'M6 16V11a6 6 0 1112 0v5l1.5 2h-15L6 16zm4 4a2 2 0 004 0',
  mic: 'M12 15a3 3 0 003-3V6a3 3 0 10-6 0v6a3 3 0 003 3zm6-3a6 6 0 01-12 0m6 6v3',
  send: 'M4 12l16-8-6 16-2.5-6.5L4 12z',
  clock: 'M12 7v5l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 0114 0',
  briefcase: 'M4 8h16a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1zm5 0V6a1 1 0 011-1h4a1 1 0 011 1v2M3 13h18',
  run: 'M13 5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM6 21l3-6 3 2v4m-3-6l1-5 4 1 2 3m-6-4l-3 2',
  cart: 'M3 4h2l2.4 11h10.2l2-8H6.2M10 20a1 1 0 100-2 1 1 0 000 2zm8 0a1 1 0 100-2 1 1 0 000 2z',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z',
  home: 'M4 11l8-7 8 7v8a1 1 0 01-1 1h-4v-6h-6v6H5a1 1 0 01-1-1v-8z',
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
  trash: 'M5 7h14M10 7V4h4v3m-6 0l1 13h6l1-13',
  x: 'M6 6l12 12M18 6L6 18',
  play: 'M8 5l11 7-11 7V5z',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3A4 4 0 0011 18.7l1-1',
  arrow: 'M5 12h14m-6-6l6 6-6 6',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  doc: 'M7 3h7l5 5v12a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1zm7 0v5h5',
};

interface Props extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 20, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
