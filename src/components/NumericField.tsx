import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronDown, ChevronUp } from '../icons';
import { useEditorStore } from '../state/editorStore';
import { adjustNumericValue, parseNumericExpression } from '../core/numeric';

interface Props {
  value:number; onChange:(value:number)=>void; min?:number; max?:number; step:number;
  displayScale?:number; disabled?:boolean; integer?:boolean; defaultValue?:number;
  ariaLabel?:string;
}
const format = (value:number) => Number(value.toFixed(5)).toString();

export function NumericField(props: Props) {
  const { value,onChange,min,max,step,displayScale=1,disabled=false,integer=false,defaultValue } = props;
  const [editing,setEditing] = useState(false);
  const [draft,setDraft] = useState('');
  const [invalid,setInvalid] = useState(false);
  const [validationMessage,setValidationMessage] = useState('');
  const validationId = useId();
  const input = useRef<HTMLInputElement>(null);
  const current = useRef(value);
  const base = useRef(value);
  const draftRef = useRef('');
  const active = useRef(false);
  const skipBlurCommit = useRef(false);
  const gesture = useRef<{x:number;y:number;value:number;scrub:boolean;stepDirection?:number} | null>(null);
  const latest = useRef(props);
  latest.current = props;
  if (!gesture.current?.scrub) current.current = value;
  const begin = () => { if (!active.current) { useEditorStore.getState().beginNumericEdit(); active.current=true; base.current=current.current; } };
  const end = (cancel=false) => { if (active.current) { useEditorStore.getState().endNumericEdit(cancel); active.current=false; } };
  const apply = (raw:number) => {
    if (!Number.isFinite(raw) || disabled) return;
    const normalized = Math.max(min ?? -Infinity,Math.min(max ?? Infinity,integer ? Math.round(raw) : raw));
    if (normalized !== current.current) { begin(); current.current=normalized; onChange(normalized); }
    setInvalid(false);
  };
  const changeDraft = (text:string) => { draftRef.current=text;setDraft(text); };
  const bump = (direction:number,event:{shiftKey?:boolean;altKey?:boolean}) => {
    apply(adjustNumericValue(current.current,step,direction,{...event,min,max,integer}));
    changeDraft(format(current.current*displayScale));
  };
  const commit = () => {
    if (skipBlurCommit.current) {skipBlurCommit.current=false;setEditing(false);setInvalid(false);return;}
    if (!gesture.current?.scrub && editing) {
      const result = parseNumericExpression(draftRef.current,base.current*displayScale,displayScale);
      if (result === null) {
        gesture.current=null;current.current=base.current;end(true);
        setEditing(false);setInvalid(false);
        setValidationMessage('Invalid formula. Previous value restored.');
        return;
      }
      if (result !== null) apply(result/displayScale);
    }
    gesture.current=null;setEditing(false);setInvalid(false);end();
  };
  useEffect(() => {
    const element=input.current;
    if (!element) return;
    const wheel=(event:WheelEvent) => {
      if (document.activeElement !== element || latest.current.disabled || event.ctrlKey || !event.deltaY) return;
      event.preventDefault();event.stopPropagation();
      // A wheel tick changes one step, independent of browser pixel/line units.
      const p=latest.current;
      const next=adjustNumericValue(current.current,p.step,event.deltaY<0?1:-1,{...p,shiftKey:event.shiftKey,altKey:event.altKey});
      if (next===current.current) return;
      if (!active.current) {useEditorStore.getState().beginNumericEdit();active.current=true;}
      current.current=next;p.onChange(next);changeDraft(format(next*(p.displayScale??1)));setInvalid(false);
    };
    element.addEventListener('wheel',wheel,{passive:false});
    return () => element.removeEventListener('wheel',wheel);
  },[]);
  useEffect(() => () => { if (active.current) useEditorStore.getState().endNumericEdit(); },[]);
  const pointerDown=(event:ReactPointerEvent<HTMLElement>,stepDirection?:number) => {
    if (disabled || event.button!==0) return;
    if (stepDirection) event.preventDefault();
    begin();gesture.current={x:event.clientX,y:event.clientY,value:current.current,scrub:false,stepDirection};
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove=(event:ReactPointerEvent<HTMLElement>) => {
    const g=gesture.current;if(!g) return;
    const dx=event.clientX-g.x,dy=g.y-event.clientY;
    if(!g.scrub&&Math.max(Math.abs(dx),Math.abs(dy))<4)return;
    g.scrub=true;setEditing(false);
    apply(adjustNumericValue(g.value,step,Math.abs(dx)>=Math.abs(dy)?dx:dy,{shiftKey:event.shiftKey,altKey:event.altKey,min,max,integer}));
    changeDraft(format(current.current*displayScale));
  };
  const pointerUp=(event:ReactPointerEvent<HTMLElement>) => {
    const g=gesture.current;if(!g)return;
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
    if(g.scrub){input.current?.blur();gesture.current=null;end();}
    else if(g.stepDirection){bump(g.stepDirection,event);gesture.current=null;end();}
    else gesture.current=null;
  };
  return <span className="numeric-control"><span className={`numeric-field ${invalid?'numeric-field--invalid':''}`}>
    <input ref={input} className="numericScrubInput" type="text" inputMode="decimal" disabled={disabled} aria-label={props.ariaLabel}
      value={editing?draft:format(value*displayScale)} aria-invalid={invalid || undefined}
      aria-describedby={validationMessage ? validationId : undefined}
      title="Type a value or formula · drag to scrub · ↑/↓ or focused scroll to step · Shift ×10 · Alt ×0.1 · Esc cancels"
      onFocus={()=>{setValidationMessage('');begin();setEditing(true);changeDraft(format(value*displayScale));}}
      onBlur={commit}
      onChange={event=>{setValidationMessage('');begin();const text=event.target.value;changeDraft(text);const result=parseNumericExpression(text,base.current*displayScale,displayScale);setInvalid(result===null);if(result!==null)apply(result/displayScale);}}
      onKeyDown={event=>{
        if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();bump(event.key==='ArrowUp'?1:-1,event);}
        if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();gesture.current=null;skipBlurCommit.current=true;end(true);setEditing(false);setInvalid(false);changeDraft(format(base.current*displayScale));event.currentTarget.blur();}
      }}
      onPointerDown={event=>pointerDown(event)} onPointerMove={pointerMove} onPointerUp={pointerUp}
      onPointerCancel={()=>{gesture.current=null;end(true);setEditing(false);}}
    />
    <span className="numeric-stepper" title="Drag horizontally or vertically to scrub; right-click to reset">
      {[1,-1].map(direction=><button key={direction} type="button" disabled={disabled} tabIndex={-1}
        aria-label={direction===1?'Increase value':'Decrease value'}
        onPointerDown={event=>pointerDown(event,direction)} onPointerMove={pointerMove} onPointerUp={pointerUp}
        onPointerCancel={()=>{gesture.current=null;end(true);}}
        onContextMenu={event=>{if(defaultValue===undefined||disabled)return;event.preventDefault();begin();apply(defaultValue);end();}}>
        {direction===1?<ChevronUp/>:<ChevronDown/>}
      </button>)}
    </span>
  </span><span className="numeric-feedback" id={validationId} role="status">{validationMessage}</span></span>;
}
