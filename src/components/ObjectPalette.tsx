import { Crosshair, Lightbulb, ChevronDown } from '../icons';
import { PRIMITIVES } from '../core/primitives';
import type { PrimitiveType } from '../core/types';
import { PrimitiveIcon } from './PrimitiveIcon';

export function ObjectPalette({onPrimitive,onNull,onLight}: {
  onPrimitive:(type:PrimitiveType)=>void;onNull:()=>void;onLight:()=>void;
}) {
  return <details className="object-palette" open>
    <summary><ChevronDown/><span>Create objects</span><small>Parametric</small></summary>
    <div className="object-palette__grid" aria-label="Primitive objects">
      {PRIMITIVES.map(item=><button key={item.type} aria-label={`Create ${item.name}`} title={`Create parametric ${item.name.toLowerCase()}`}
        onClick={()=>onPrimitive(item.type)}><PrimitiveIcon type={item.type}/><span>{item.name}</span></button>)}
    </div>
    <div className="object-palette__utilities">
      <button onClick={onNull} title="Create an empty hierarchy object"><Crosshair/>Null</button>
      <button onClick={onLight}><Lightbulb/>Area light</button>
    </div>
  </details>;
}
