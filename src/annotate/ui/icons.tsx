import { Svg, type IconProps } from '../../pages/shared/icons';

/** Annotation tool icons (24 px grid, stroked with currentColor). */
export const IconPointer = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 3l14 7-6 2-2 6z" />
  </Svg>
);
export const IconArrow = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 19L19 5M10 5h9v9" />
  </Svg>
);
export const IconLine = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 19L19 5" />
  </Svg>
);
export const IconRect = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="6" width="16" height="12" rx="1" />
  </Svg>
);
export const IconEllipse = (p: IconProps) => (
  <Svg {...p}>
    <ellipse cx="12" cy="12" rx="8" ry="6" />
  </Svg>
);
export const IconPen = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20l4-1L19 8l-3-3L5 16z" />
    <path d="M14 7l3 3" />
  </Svg>
);
export const IconHighlighter = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 15l-4 5h6l2-2" />
    <path d="M9 15l7-11 4 3-7 11z" />
  </Svg>
);
export const IconTextTool = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 6V4h14v2M12 4v16M9 20h6" />
  </Svg>
);
export const IconStep = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M11 9l2-1v8" />
  </Svg>
);
export const IconCallout = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5h16v10H10l-4 4v-4H4z" />
  </Svg>
);
export const IconStamp = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M9 10h.01M15 10h.01M8.5 14a4 4 0 0 0 7 0" />
  </Svg>
);
export const IconRedact = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="8" width="18" height="8" rx="1" />
    <path d="M7 8v8M11 8v8M15 8v8" />
  </Svg>
);
export const IconSpotlight = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M3 3h18v18H3z" />
  </Svg>
);
export const IconUndo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </Svg>
);
export const IconRedo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H10a6 6 0 0 0 0 12h3" />
  </Svg>
);
export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Svg>
);
export const IconShield = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" />
    <path d="M9 12l2 2 4-4" />
  </Svg>
);
