import { Axis3D, Focus, ArrowDownToLine, RotateCcw } from '../icons';
import type { SceneNodeRecord, Vec3Tuple } from '../core/types';
import { NumericField } from './NumericField';

export function AxisEditor({node,active,onMode,onChange,onTarget}: {
  node:SceneNodeRecord;active:boolean;onMode:(enabled:boolean)=>void;
  onChange:(pivot:Vec3Tuple)=>void;onTarget:(target:'center'|'base'|'origin')=>void;
}) {
  return <details className={`axis-editor ${active?'axis-editor--active':''}`} open={active || undefined}>
    <summary><Axis3D/><span>Object axis</span><small>{active?'Editing axis':'Pivot'}</small></summary>
    <div className="axis-editor__body">
      <button className={`axis-edit-toggle ${active?'active':''}`} aria-pressed={active} disabled={node.locked}
        aria-label={active?'Finish axis editing':'Adjust axis'}
        onClick={()=>onMode(!active)}><Axis3D/>{active?'Finish axis editing':'Adjust axis'}<kbd>L</kbd></button>
      <div className="axis-targets">
        <button disabled={node.locked} title="Reset axis to object bounds center without moving geometry" onClick={()=>onTarget('center')}><Focus/>Center</button>
        <button disabled={node.locked} title="Move axis to the bottom center of the object" onClick={()=>onTarget('base')}><ArrowDownToLine/>Base</button>
        <button disabled={node.locked} title="Restore the original asset axis without moving geometry" onClick={()=>onTarget('origin')}><RotateCcw/>Original</button>
      </div>
      <span className="transformGroup__title">Axis offset (cm)</span>
      <div className="transformGroup__grid">{['X','Y','Z'].map((axis,index)=><label key={axis}>
        <span className={`axis-label axis-label--${axis.toLowerCase()}`}>{axis}</span>
        <NumericField ariaLabel={`Axis ${axis} (cm)`} value={(node.pivotOffset??[0,0,0])[index]} displayScale={100} step={.001}
          disabled={node.locked} defaultValue={0} onChange={value=>{const pivot=[...(node.pivotOffset??[0,0,0])] as Vec3Tuple;pivot[index]=value;onChange(pivot)}}/>
      </label>)}</div>
      <p className="fieldHint">Moves the pivot only. Geometry and children stay in place. Rotate and Scale use the new pivot in Object mode.</p>
    </div>
  </details>;
}
