// SPDX-License-Identifier: CC0-1.0
// Original geometric icon artwork. No external icon fonts or sprites.
import type { ReactNode, SVGProps } from 'react';

function icon(geometry: ReactNode) {
  return function Icon(props: SVGProps<SVGSVGElement>) {
    return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"
      fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true} role={props['aria-label'] ? 'img' : undefined} {...props}>{geometry}</svg>;
  };
}
const corners = <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>;
const panel = <><rect x="2" y="3" width="20" height="18" rx="1"/><path d="M9 3v18"/></>;
export const Box = icon(<><path d="m12 2 9 5v10l-9 5-9-5V7Z"/><path d="m3 7 9 5 9-5M12 12v10"/></>);
export const Axis3D = icon(<path d="M5 18V4m0 14h15M5 18l10-9M3 6l2-2 2 2m11 10 2 2-2 2m-6-11h3v3"/>);
export const Focus = icon(<>{corners}<circle cx="12" cy="12" r="3"/></>);
export const Scan = icon(<>{corners}<path d="M4 12h16"/></>);
export const Camera = icon(<><rect x="3" y="7" width="18" height="13" rx="2"/><path d="m7 7 2-4h6l2 4"/><circle cx="12" cy="13" r="4"/></>);
export const ChevronDown = icon(<path d="m5 8 7 7 7-7"/>);
export const ChevronUp = icon(<path d="m5 16 7-7 7 7"/>);
export const ChevronRight = icon(<path d="m8 5 7 7-7 7"/>);
export const Folder = icon(<path d="M2 5h8l3 3h9v12H2Z"/>);
export const Layers3 = icon(<><path d="m12 3 10 5-10 5L2 8Z"/><path d="m3 12 9 5 9-5m-18 5 9 5 9-5"/></>);
export const Search = icon(<><circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/></>);
export const Globe2 = icon(<><circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="4" ry="10"/><path d="M2 12h20"/></>);
export const Lightbulb = icon(<><path d="M8 17c0-3-4-4-4-8a8 8 0 0 1 16 0c0 4-4 5-4 8Zm0 3h8m-6 3h4M10 17V9m4 8V9"/></>);
export const Lock = icon(<><rect x="4" y="10" width="16" height="12" rx="2"/><path d="M7 10V6a5 5 0 0 1 10 0v4m-5 5v3"/></>);
export const Unlock = icon(<><rect x="4" y="10" width="16" height="12" rx="2"/><path d="M7 10V6a5 5 0 0 1 9-3m-4 12v3"/></>);
export const Magnet = icon(<path d="M3 4h6v9a3 3 0 0 0 6 0V4h6v9a9 9 0 0 1-18 0Zm0 5h6m6 0h6"/>);
export const Maximize2 = icon(<path d="M3 9V3h6m6 18h6v-6M3 3l7 7m4 4 7 7"/>);
export const Minimize2 = icon(<path d="M9 3v6H3m12 12v-6h6M9 9 2 2m13 13 7 7"/>);
export const Move = icon(<path d="M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3m14-6 3 3-3 3"/>);
export const PanelLeftClose = icon(<>{panel}<path d="m16 8-4 4 4 4"/></>);
export const PanelLeftOpen = icon(<>{panel}<path d="m13 8 4 4-4 4"/></>);
export const PanelRightClose = icon(<><rect x="2" y="3" width="20" height="18" rx="1"/><path d="M15 3v18m-7-13 4 4-4 4"/></>);
export const PanelRightOpen = icon(<><rect x="2" y="3" width="20" height="18" rx="1"/><path d="M15 3v18m-4-13-4 4 4 4"/></>);
export const Redo2 = icon(<path d="m16 3 5 5-5 5m5-5H9a6 6 0 0 0 0 12h5"/>);
export const Undo2 = icon(<path d="m8 3-5 5 5 5M3 8h12a6 6 0 0 1 0 12h-5"/>);
export const Rotate3D = icon(<><ellipse cx="12" cy="12" rx="10" ry="5"/><path d="m17 3 3 4-5 1M12 3v18"/></>);
export const Scaling = icon(<><rect x="3" y="14" width="7" height="7"/><path d="M3 10V3h18v18h-7M12 12l9-9m-7 0h7v7"/></>);
export const Upload = icon(<path d="M12 16V3m-4 4 4-4 4 4M4 15v6h16v-6"/>);
export const Crosshair = icon(<><circle cx="12" cy="12" r="7"/><path d="M12 1v7m0 8v7M1 12h7m8 0h7"/></>);
export const ArrowDownToLine = icon(<path d="M12 2v15m-5-5 5 5 5-5M3 22h18"/>);
export const RotateCcw = icon(<path d="M3 3v7h7M3 10a9 9 0 1 1 1 8"/>);
export const Grid3X3 = icon(<><rect x="3" y="3" width="18" height="18"/><path d="M9 3v18m6-18v18M3 9h18M3 15h18"/></>);
export const Mouse = icon(<><rect x="5" y="2" width="14" height="20" rx="7"/><path d="M5 10h14M12 2v8"/></>);
export const Sparkles = icon(<path d="m10 3 2 6 6 2-6 2-2 6-2-6-6-2 6-2Zm9 12 1 3 3 1-3 1-1 3-1-3-3-1 3-1Z"/>);
export const Plus = icon(<path d="M12 3v18M3 12h18"/>);
export const Check = icon(<path d="m3 12 6 7L21 4"/>);
export const ImageDown = icon(<><path d="M12 21H2V3h20v9M3 18l6-7 5 5m4-1v8m-4-4 4 4 4-4"/><circle cx="16" cy="7" r="2"/></>);
export const Pencil = icon(<path d="m3 16 13-13 5 5L8 21l-6 1Zm10-10 5 5M3 16l5 5"/>);
export const X = icon(<path d="m4 4 16 16M20 4 4 20"/>);
