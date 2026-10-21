import { useEffect, useRef, useState } from 'react';
import { Box, Check, ChevronDown, ImageDown, Pencil, X } from '../icons';

export interface MenuAction {
  label: string;
  shortcut?: string;
  action: () => void;
  disabled?: boolean;
}

export function EditorMenuBar({ name, onRename, menus, saveState, onExport }: {
  name: string;
  onRename: (name: string) => void;
  menus: Record<string, MenuAction[]>;
  saveState: 'saving' | 'saved' | 'error';
  onExport: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(null); setRenaming(false); }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  const commitName = () => { if (draft.trim()) onRename(draft); setRenaming(false); };
  return <header className="menubar" ref={ref}>
    <div className="studio-brand"><Box /><strong>Three <span>Render</span></strong></div>
    <nav aria-label="Editor menus">
      {Object.entries(menus).map(([label, actions]) => <div className="menu-wrap" key={label}>
        <button className={open === label ? 'menu-trigger active' : 'menu-trigger'}
          aria-haspopup="menu" aria-expanded={open === label}
          onClick={() => setOpen(open === label ? null : label)}>{label}<ChevronDown /></button>
        {open === label ? <div className="editor-menu" role="menu">
          {actions.map((item) => <button role="menuitem" aria-label={item.label} key={item.label} disabled={item.disabled}
            onClick={() => { setOpen(null); item.action(); }}>
            <span>{item.label}</span><kbd>{item.shortcut}</kbd>
          </button>)}
        </div> : null}
      </div>)}
    </nav>
    <div className="project-title">
      {renaming ? <input aria-label="Project name" autoFocus value={draft}
        onChange={(event) => setDraft(event.target.value)} onBlur={commitName}
        onKeyDown={(event) => { if (event.key === 'Enter') commitName(); }} />
        : <button title="Rename project" onClick={() => { setDraft(name); setRenaming(true); }}>
          <span>{name}</span><Pencil />
        </button>}
    </div>
    <span className={`save-state save-state--${saveState}`}>
      {saveState === 'saved' ? <Check /> : <span className="status-dot" />}
      {saveState === 'saved' ? 'Saved locally' : saveState === 'saving' ? 'Saving…' : 'Save failed'}
    </span>
    <button className="export-button" aria-label="Export image" title="Export image (PNG)" onClick={onExport}><ImageDown /><span>Export image</span></button>
  </header>;
}

const shortcuts = [
  ['Adjust object axis', 'L'],
  ['Viewport pan / zoom / orbit', 'Hold 1 / 2 / 3 + drag'],
  ['Numeric steps', '↑ / ↓ · focused scroll'],
  ['Numeric coarse / fine', 'Shift ×10 / Alt ×0.1'],
  ['Cancel numeric edit', 'Esc'],
  ['Move / Rotate / Scale', 'W / E / R'], ['Frame selection', 'F'], ['Frame scene', 'Shift F'],
  ['Duplicate', '⌘ / Ctrl D'], ['Undo / Redo', '⌘ / Ctrl Z / Shift Z'],
  ['Save project file', '⌘ / Ctrl S'], ['Open project', '⌘ / Ctrl O'],
  ['Rename object', 'F2'], ['Delete object', 'Delete'], ['Clear selection', 'Esc'],
  ['Orbit', 'Left drag'], ['Pan', 'Right drag'], ['Zoom', 'Scroll'],
];

export function ShortcutDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog className="shortcut-dialog" ref={dialog} onCancel={onClose}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <header><h2>Keyboard & navigation</h2><button aria-label="Close shortcuts" onClick={onClose}><X /></button></header>
    <dl>{shortcuts.map(([label, key]) => <div key={label}><dt>{label}</dt><dd><kbd>{key}</kbd></dd></div>)}</dl>
  </dialog>;
}
