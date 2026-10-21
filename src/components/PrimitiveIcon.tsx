// SPDX-License-Identifier: CC0-1.0
import type { PrimitiveType } from '../core/types';

/** Small wireframe silhouettes remain legible in both the palette and scene tree. */
export function PrimitiveIcon({type}: {type: PrimitiveType}) {
  return <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {type === 'cube' ? <><path d="m16 3 12 7v13l-12 7L4 23V10Z" fill="currentColor" fillOpacity=".07"/><path d="m4 10 12 7 12-7M16 17v13M16 3v14"/><path d="m4 23 12-7 12 7" strokeDasharray="2 2" opacity=".4"/></> : null}
    {type === 'sphere' ? <><circle cx="16" cy="16" r="13" fill="currentColor" fillOpacity=".07"/><ellipse cx="16" cy="16" rx="6" ry="13"/><ellipse cx="16" cy="16" rx="13" ry="5"/><path d="M3 16h26M16 3v26" opacity=".45"/></> : null}
    {type === 'cylinder' ? <><ellipse cx="16" cy="7" rx="11" ry="4"/><path d="M5 7v18c0 5 22 5 22 0V7M16 11v18"/><path d="M5 25c0-5 22-5 22 0" strokeDasharray="2 2" opacity=".5"/></> : null}
    {type === 'cone' ? <><path d="M16 3 3 25c0 6 26 6 26 0ZM16 3v26" fill="currentColor" fillOpacity=".07"/><path d="M3 25c0-6 26-6 26 0" strokeDasharray="2 2" opacity=".5"/></> : null}
    {type === 'torus' ? <><ellipse cx="16" cy="16" rx="14" ry="10" fill="currentColor" fillOpacity=".07"/><ellipse cx="16" cy="15" rx="7" ry="4"/><path d="M3 13c-2 12 28 12 26 0M8 8c-5 6-1 15 2 16M24 8c5 6 1 15-2 16" opacity=".55"/></> : null}
    {type === 'capsule' ? <><rect x="7" y="2" width="18" height="28" rx="9" fill="currentColor" fillOpacity=".07"/><path d="M7 11c0 5 18 5 18 0M7 21c0 5 18 5 18 0M16 2v28"/><path d="M7 11c0-5 18-5 18 0M7 21c0-5 18-5 18 0" strokeDasharray="2 2" opacity=".4"/></> : null}
    {type === 'plane' ? <><path d="m3 20 10-12 17 5-10 12Z" fill="currentColor" fillOpacity=".07"/><path d="m8 14 17 5M9 22 20 10M17 10 6 21M25 12 14 24" opacity=".5"/></> : null}
    {type === 'disc' ? <><ellipse cx="16" cy="17" rx="14" ry="8" fill="currentColor" fillOpacity=".07"/><path d="M2 17h28M16 9v16M6 11l20 12M6 23l20-12" opacity=".5"/></> : null}
  </svg>;
}
