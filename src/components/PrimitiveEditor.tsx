import { Box, RotateCcw } from '../icons';
import { PRIMITIVES, normalizePrimitiveParameters } from '../core/primitives';
import type { PrimitiveParameters, PrimitiveType } from '../core/types';
import { NumericField } from './NumericField';

export function PrimitiveEditor({type,parameters,disabled,onChange,onMakeEditable}:{
  type:PrimitiveType;parameters?:PrimitiveParameters;disabled:boolean;
  onChange:(parameters:PrimitiveParameters)=>void;onMakeEditable:()=>void;
}) {
  const definition=PRIMITIVES.find(item=>item.type===type)!;
  const values=normalizePrimitiveParameters(type,parameters);
  return <details className="primitive-editor" open>
    <summary><Box/><span>Object properties</span><small>{definition.name}</small></summary>
    <div className="primitive-fields">
      {definition.fields.map(field=>typeof field.default==='boolean'
        ? <label className="checkbox" key={field.key}><input type="checkbox" disabled={disabled}
            checked={values[field.key] as boolean} onChange={event=>onChange({[field.key]:event.target.checked})}/>{field.label}</label>
        : <label key={field.key}>{field.label}{field.length?' (cm)':''}
            <NumericField value={values[field.key] as number} step={field.step??1} min={field.min} max={field.max}
              ariaLabel={`${field.label}${field.length?' (cm)':''}`}
              integer={field.integer} displayScale={field.length?100:1} defaultValue={field.default as number}
              disabled={disabled || (type==='cube' && (field.key==='filletSegments' ? values.fillet===0 : field.key.endsWith('Segments') && field.key!=='filletSegments' && (values.fillet as number)>0))}
              onChange={value=>onChange({[field.key]:value})}/>
          </label>)}
    </div>
    {type==='cube' && (values.fillet as number)>0 ? <p className="fieldHint">Fillet subdivisions control the rounded cube mesh.</p>:null}
    <div className="primitive-actions">
      <button disabled={disabled} title="Reset object parameters" onClick={()=>onChange(normalizePrimitiveParameters(type))}><RotateCcw/>Reset parameters</button>
      <button disabled={disabled} title="Bake a static mesh; undo restores the parametric object" onClick={onMakeEditable}>Make editable</button>
    </div>
  </details>;
}
