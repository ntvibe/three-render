import assert from 'node:assert/strict';
import catalog from '../public/catalog/catalog.json';
import { useEditorStore } from '../src/state/editorStore';
import { worldMatrixForNode, worldTransformForNode } from '../src/core/sceneTransforms';
import { readProjectFile } from '../src/core/persistence';
import { createMaterialRecord } from '../src/core/materials';
import { getMaterialUsages } from '../src/core/materialUsage';
import { getIsolationNodeIds, isObjectVisible } from '../src/core/sceneVisibility';
import { createPrimitiveGeometry, normalizePrimitiveParameters, PRIMITIVES } from '../src/core/primitives';
import { parseNumericExpression, adjustNumericValue } from '../src/core/numeric';
import { BoxGeometry, Group, Mesh, Raycaster, BufferGeometryLoader, MeshPhysicalMaterial, ShaderChunk, Matrix4, Vector3 } from 'three';
import { PhysicalPathTracingMaterial } from 'three-gpu-pathtracer';
import { cauchyIor, abbeToDispersion, dispersionToAbbe } from '../src/engine/glassOptics';
import { patchSpectralShader, syncSpectralDispersion, MATERIAL_STRIDE, DISPERSION_FLOAT_OFFSET } from '../src/engine/spectralDispersion';
import { patchRealtimeTransmission } from '../src/engine/realtimeGlass';
import type { WebGLPathTracer } from 'three-gpu-pathtracer';
import type { CatalogManifest } from '../src/core/types';
import { createLightRecord, normalizeShadowSpread } from '../src/core/lights';
import { packAreaShadowSpread, patchAreaShadowShader } from '../src/engine/areaShadows';
import { ShapedAreaLight } from 'three-gpu-pathtracer';
import { PointLight } from 'three';

export async function runRegressions() {
  let passed = 0;
  const test = async (name: string, run: () => void | Promise<void>) => {
    useEditorStore.getState().initialize(catalog as CatalogManifest);
    await run();
    console.log(`✓ ${name}`);
    passed++;
  };
  const state = () => useEditorStore.getState();
  const close = (a: number[], b: number[]) => a.forEach((value, index) => assert.ok(Math.abs(value - b[index]) < 1e-8));

  await test('World placement survives rotated and scaled parenting and unparenting', () => {
    state().addPrimitive('cube');
    const child = state().selectedNodeId!;
    state().updateTransform(child, { position: [0.3, 0.7, -0.2], rotation: [0.1, 0.3, 0.2] }, true);
    state().addPrimitive('sphere');
    const parent = state().selectedNodeId!;
    state().updateTransform(parent, { position: [1, 2, 3], rotation: [0, 0.6, 0], scale: [2, 2, 2] }, true);
    const before = worldMatrixForNode(state().project!, child).elements;
    state().reparentNode(child, parent);
    close(worldMatrixForNode(state().project!, child).elements, before);
    state().selectNode(child);
    state().unparentSelected();
    assert.equal(state().project!.nodes[child].parentId, null);
    close(worldMatrixForNode(state().project!, child).elements, before);
  });

  await test('Moving nodes between groups preserves world placement and rejects cycles', () => {
    state().addPrimitive('cube'); const parent = state().selectedNodeId!;
    state().updateTransform(parent, { position: [3, 0, 0] }, true);
    state().addPrimitive('sphere'); const child = state().selectedNodeId!;
    const before = worldTransformForNode(state().project!, child);
    state().moveNode(child, parent, 0);
    close(worldTransformForNode(state().project!, child).position, before.position);
    state().reparentNode(parent, child);
    assert.equal(state().project!.nodes[parent].parentId, null);
  });

  await test('A continuous transform gesture undoes to its starting pose', () => {
    state().addPrimitive('cube'); const id = state().selectedNodeId!;
    state().updateTransform(id, { position: [0.2, 0, 0] }, false);
    state().updateTransform(id, { position: [0.4, 0, 0] }, false);
    state().updateTransform(id, { position: [0.6, 0, 0] }, true);
    state().undo(); assert.equal(state().project!.nodes[id].transform.position[0], 0);
    state().redo(); assert.equal(state().project!.nodes[id].transform.position[0], 0.6);
  });

  await test('Reordering siblings preserves transforms under nonuniform parent scale', () => {
    state().addPrimitive('cube'); const child = state().selectedNodeId!;
    state().addNull(); const parent = state().selectedNodeId!;
    state().reparentNode(child, parent);
    state().updateTransform(parent, { rotation: [0, .6, 0], scale: [2, 1, 1] }, true);
    state().updateTransform(child, { rotation: [.1, .5, .2] }, true);
    state().addPrimitive('sphere'); const sibling = state().selectedNodeId!;
    state().reparentNode(sibling, parent);
    const before = structuredClone(state().project!.nodes[child].transform);
    const matrix = worldMatrixForNode(state().project!, child).elements;
    state().moveNode(child, parent, 2);
    assert.deepEqual(state().project!.nodes[parent].children, [sibling, child]);
    assert.deepEqual(state().project!.nodes[child].transform, before);
    close(worldMatrixForNode(state().project!, child).elements, matrix);
    state().undo();
    assert.deepEqual(state().project!.nodes[parent].children, [child, sibling]);
    close(worldMatrixForNode(state().project!, child).elements, matrix);
  });

  await test('Isolation includes a group subtree and keeps authored visibility on exit and undo', () => {
    const hidden = state().project!.rootNodeIds[1];
    state().toggleNodeVisibility(hidden);
    state().addPrimitive('cube'); const child = state().selectedNodeId!;
    state().groupSelected(); const group = state().selectedNodeId!;
    state().addLightNode(); const light = state().selectedNodeId!;
    state().selectNode(group);
    const visibility = Object.fromEntries(Object.values(state().project!.nodes).map((node) => [node.id, node.visible]));
    state().isolateSelected();
    const isolated = getIsolationNodeIds(state().project!)!;
    assert.ok(isolated.has(group)); assert.ok(isolated.has(child)); assert.ok(isolated.has(light));
    assert.ok(!isolated.has(hidden));
    state().clearIsolation();
    assert.equal(getIsolationNodeIds(state().project!), null);
    assert.deepEqual(Object.fromEntries(Object.values(state().project!.nodes).map((node) => [node.id, node.visible])), visibility);
    state().undo(); assert.ok(getIsolationNodeIds(state().project!)!.has(child));
    state().redo(); assert.equal(getIsolationNodeIds(state().project!), null);
  });

  await test('Isolation of a nested mesh keeps ancestors without revealing its siblings', () => {
    state().addPrimitive('cube'); const child = state().selectedNodeId!;
    state().groupSelected(); const group = state().selectedNodeId!;
    state().addPrimitive('sphere'); const sibling = state().selectedNodeId!;
    state().reparentNode(sibling, group);
    state().selectNode(child); state().isolateSelected();
    const isolated = getIsolationNodeIds(state().project!)!;
    assert.ok(isolated.has(child)); assert.ok(isolated.has(group)); assert.ok(!isolated.has(sibling));
    assert.ok(state().project!.nodes[sibling].visible);
    state().selectNode(null); state().clearIsolation();
    assert.equal(getIsolationNodeIds(state().project!), null);
  });

  await test('Hidden geometry and hidden ancestors cannot intercept visible viewport hits', () => {
    const geometry = new BoxGeometry();
    const material = new MeshPhysicalMaterial();
    const root = new Group();
    const hiddenGroup = new Group(); const hidden = new Mesh(geometry, material);
    hidden.position.z = 2; hiddenGroup.visible = false; hiddenGroup.add(hidden);
    const visible = new Mesh(geometry, material);
    root.add(hiddenGroup, visible); root.updateMatrixWorld(true);
    const raycaster = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
    const hits = raycaster.intersectObjects(root.children, true);
    assert.equal(hits[0].object, hidden);
    assert.equal(hits.find((hit) => isObjectVisible(hit.object))!.object, visible);
    hiddenGroup.visible = true; hidden.visible = false;
    assert.equal(hits.find((hit) => isObjectVisible(hit.object))!.object, visible);
    geometry.dispose(); material.dispose();
  });

  await test('Locked lights reject property changes until unlocked', () => {
    state().addLightNode(); const id = state().selectedNodeId!;
    const light = state().project!.nodes[id].light!;
    state().toggleSelectedLock();
    const before = state().project;
    state().updateNode(id, { light: { ...light, intensity: 99 } });
    state().updateNode(id, { light: { ...light, type: 'point' } });
    assert.equal(state().project, before);
    state().updateNode(id, { locked: false });
    state().updateNode(id, { light: { ...light, intensity: 99 } });
    assert.equal(state().project!.nodes[id].light!.intensity, 99);
  });

  await test('Locked descendants survive parent deletion and locked nodes reject hierarchy edits', () => {
    state().addPrimitive('cube'); const child = state().selectedNodeId!;
    state().groupSelected(); const group = state().selectedNodeId!;
    state().selectNode(child); state().toggleSelectedLock();
    const before = state().project;
    state().groupSelected(); state().unparentSelected();
    state().reparentNode(child, null); state().moveNode(child, null, 0);
    assert.equal(state().project, before);
    state().selectNode(group); state().deleteSelected();
    assert.equal(state().project, before);
    state().selectNode(child); state().toggleSelectedLock();
    state().selectNode(group); state().deleteSelected();
    assert.equal(state().project!.nodes[group], undefined);
    assert.equal(state().project!.nodes[child], undefined);
    state().undo(); assert.ok(state().project!.nodes[child]);
  });

  await test('Undo and redo keep the surviving object and its material element selected', () => {
    const original = state().project!.rootNodeIds[0];
    state().selectNode(original); state().duplicateSelected();
    const copy = state().selectedNodeId!;
    const binding = state().project!.assets[state().project!.nodes[copy].assetId!].meshBindings[0].id;
    state().selectBinding(copy, binding);
    state().makeMaterialUnique(copy, binding);
    const unique = state().selectedMaterialId;
    state().undo();
    assert.equal(state().selectedNodeId, copy); assert.equal(state().selectedBindingId, binding);
    assert.notEqual(state().selectedMaterialId, unique);
    state().redo();
    assert.equal(state().selectedNodeId, copy); assert.equal(state().selectedBindingId, binding);
    assert.equal(state().selectedMaterialId, unique);
    state().selectNode('__camera__'); state().undo();
    assert.equal(state().selectedNodeId, '__camera__');
    state().selectNode(null); state().redo(); assert.equal(state().selectedNodeId, null);
  });

  await test('Locked objects reject transform and delete operations', () => {
    state().addPrimitive('cube'); const id = state().selectedNodeId!;
    state().toggleSelectedLock();
    state().updateTransform(id, { position: [9, 9, 9] }, true);
    state().deleteSelected();
    assert.deepEqual(state().project!.nodes[id].transform.position, [0, 0, 0]);
  });

  await test('Camera and environment pseudo selections cannot crash object actions', () => {
    for (const id of ['__camera__', '__environment__']) {
      state().selectNode(id); state().duplicateSelected(); state().deleteSelected();
      state().groupSelected(); state().unparentSelected(); state().toggleSelectedLock(); state().isolateSelected();
    }
    assert.ok(state().project);
  });

  await test('Loading model metadata preserves edited material records', () => {
    state().addPrimitive('cube');
    const node = state().project!.nodes[state().selectedNodeId!];
    const assetId = node.assetId!;
    const material = createMaterialRecord({ id: `${assetId}::mat::0:0`, name: 'Edited', roughness: 0.12, color: '#123456' });
    const binding = { id: `${assetId}::binding::0:0`, label: 'Cube', meshPath: '0', slot: 0, defaultMaterialId: material.id };
    state().mergeDiscoveredMetadata({ assetId, materials: [material], meshBindings: [binding] });
    state().updateMaterial(material.id, { roughness: 0.42 });
    state().mergeDiscoveredMetadata({ assetId, materials: [material], meshBindings: [binding] });
    assert.equal(state().project!.materials[material.id].roughness, 0.42);
  });

  await test('Single-mesh material presets assign without an explicit binding click', () => {
    state().addPrimitive('cube');
    const node = state().project!.nodes[state().selectedNodeId!];
    const assetId = node.assetId!;
    const material = createMaterialRecord({ id: 'original' });
    state().mergeDiscoveredMetadata({ assetId, materials: [material], meshBindings: [{ id: 'binding', label: 'Cube', meshPath: '0', slot: 0, defaultMaterialId: material.id }] });
    state().createMaterialFromPreset('preset_chrome');
    assert.equal(state().project!.nodes[node.id].materialBindings.binding, state().selectedMaterialId);
  });

  const materialFixture = () => {
    const project = state().project!;
    const nodeId = project.rootNodeIds[0];
    const node = project.nodes[nodeId];
    const binding = project.assets[node.assetId!].meshBindings[0];
    return { nodeId, bindingId: binding.id, materialId: node.materialBindings[binding.id] ?? binding.defaultMaterialId };
  };

  await test('Shared materials require explicit scope for edits and deletion', () => {
    const { nodeId, materialId } = materialFixture();
    state().selectNode(nodeId); state().duplicateSelected();
    const before = state().project!;
    state().updateMaterial(materialId, { roughness: .81 });
    state().deleteMaterial(materialId);
    assert.equal(state().project, before);
    state().setSharedMaterialEditing(materialId);
    state().updateMaterial(materialId, { roughness: .81 });
    assert.equal(state().project!.materials[materialId].roughness, .81);
    assert.equal(getMaterialUsages(state().project!, materialId).length, 2);
    state().setSharedMaterialEditing(null);
    const after = state().project;
    state().updateMaterial(materialId, { roughness: .1 });
    assert.equal(state().project, after);
  });

  await test('Make Unique changes only the chosen assignment and is one undo step', async () => {
    const { nodeId, bindingId, materialId } = materialFixture();
    state().selectNode(nodeId); state().duplicateSelected();
    const copyId = state().selectedNodeId!;
    const before = structuredClone(state().project!);
    const historyLength = state().history.past.length;
    state().makeMaterialUnique(copyId, bindingId);
    const uniqueId = state().selectedMaterialId!;
    assert.notEqual(uniqueId, materialId);
    assert.equal(state().project!.nodes[nodeId].materialBindings[bindingId], materialId);
    assert.equal(state().project!.nodes[copyId].materialBindings[bindingId], uniqueId);
    assert.equal(state().history.past.length, historyLength + 1);
    const file = new File([JSON.stringify({ project: state().project })], 'unique.studio.json');
    assert.equal((await readProjectFile(file)).nodes[copyId].materialBindings[bindingId], uniqueId);
    state().undo(); assert.deepEqual(state().project, before);
    state().redo(); assert.equal(state().project!.nodes[copyId].materialBindings[bindingId], uniqueId);
    state().updateMaterial(uniqueId, { color: '#ff3300' });
    assert.notEqual(state().project!.materials[materialId].color, '#ff3300');
  });

  await test('Usage counts include hidden instances and default assignments, excluding overridden slots', () => {
    const { nodeId, bindingId, materialId } = materialFixture();
    state().selectNode(nodeId); state().duplicateSelected();
    const copyId = state().selectedNodeId!;
    const project = structuredClone(state().project!);
    project.assets[project.nodes[nodeId].assetId!].meshBindings[0].defaultMaterialId = materialId;
    delete project.nodes[copyId].materialBindings[bindingId];
    project.nodes[copyId].visible = false;
    state().replaceProject(project);
    assert.equal(getMaterialUsages(state().project!, materialId).length, 2);
    state().makeMaterialUnique(copyId, bindingId);
    assert.equal(getMaterialUsages(state().project!, materialId).length, 1);
    assert.equal(state().project!.nodes[copyId].visible, false);
  });

  await test('Materials shared between elements of one object are scoped per element', () => {
    const { nodeId, bindingId, materialId } = materialFixture();
    const project = structuredClone(state().project!);
    const asset = project.assets[project.nodes[nodeId].assetId!];
    asset.meshBindings.push({ ...asset.meshBindings[0], id: 'second-slot', label: 'Second slot', slot: 1, defaultMaterialId: materialId });
    state().replaceProject(project);
    assert.equal(getMaterialUsages(state().project!, materialId).length, 2);
    const before = state().project;
    state().updateMaterial(materialId, { metalness: 1 });
    assert.equal(state().project, before);
    state().makeMaterialUnique(nodeId, 'second-slot');
    assert.equal(state().project!.nodes[nodeId].materialBindings[bindingId], materialId);
    assert.notEqual(state().project!.nodes[nodeId].materialBindings['second-slot'], materialId);
  });

  await test('Locked material users reject edits, deletion, reassignment, and uniqueness', () => {
    const { nodeId, bindingId, materialId } = materialFixture();
    state().selectNode(nodeId); state().duplicateSelected();
    const copyId = state().selectedNodeId!;
    state().selectNode(nodeId); state().setSharedMaterialEditing(materialId); state().toggleSelectedLock();
    assert.equal(state().sharedMaterialEditKey, null);
    const before = state().project;
    state().setSharedMaterialEditing(materialId);
    state().updateMaterial(materialId, { roughness: .99 });
    state().deleteMaterial(materialId);
    state().assignMaterialToBinding(nodeId, bindingId, '__default_diffuse__');
    state().makeMaterialUnique(nodeId, bindingId);
    assert.equal(state().project, before);
    assert.equal(state().sharedMaterialEditKey, null);
    state().makeMaterialUnique(copyId, bindingId);
    state().updateMaterial(state().selectedMaterialId!, { roughness: .99 });
    assert.equal(state().project!.materials[state().selectedMaterialId!].roughness, .99);
    assert.notEqual(state().project!.materials[materialId].roughness, .99);
  });

  await test('Shared editing expires on navigation, history, project load, and usage changes', () => {
    const { nodeId, bindingId, materialId } = materialFixture();
    state().selectNode(nodeId); state().duplicateSelected();
    for (const navigate of [
      () => state().selectNode(nodeId),
      () => state().selectBinding(nodeId, bindingId),
      () => state().setInspectorTab('object'),
      () => state().setSelectedMaterialId(materialId),
    ]) {
      state().setSharedMaterialEditing(materialId); navigate();
      assert.equal(state().sharedMaterialEditKey, null);
    }
    state().setSharedMaterialEditing(materialId); state().duplicateSelected();
    const before = state().project;
    state().updateMaterial(materialId, { roughness: .93 });
    assert.equal(state().project, before);
    state().setSharedMaterialEditing(materialId); state().updateMaterial(materialId, { roughness: .93 });
    state().undo(); assert.equal(state().sharedMaterialEditKey, null);
    state().redo(); assert.equal(state().sharedMaterialEditKey, null);
    state().setSharedMaterialEditing(materialId); state().replaceProject(state().project!);
    assert.equal(state().sharedMaterialEditKey, null);
  });

  await test('Invalid material assignments leave project and history intact', () => {
    const { nodeId, bindingId } = materialFixture();
    const before = state().project;
    const history = state().history;
    state().assignMaterialToBinding(nodeId, bindingId, 'missing-material');
    state().assignMaterialToBinding(nodeId, 'missing-binding', '__default_diffuse__');
    state().makeMaterialUnique(nodeId, 'missing-binding');
    assert.equal(state().project, before);
    assert.equal(state().history, history);
  });

  await test('Duplicating a material selects its independent library copy', () => {
    const { nodeId, materialId } = materialFixture();
    state().selectNode(nodeId); state().duplicateMaterial(materialId);
    assert.equal(state().selectedNodeId, null);
    assert.equal(state().selectedBindingId, null);
    assert.notEqual(state().selectedMaterialId, materialId);
    assert.ok(state().project!.materials[state().selectedMaterialId!]);
  });

  await test('Project files round-trip with primitive definitions and edited transforms', async () => {
    state().addPrimitive('torus');
    const project = state().project!;
    const file = new File([JSON.stringify({ project })], 'roundtrip.studio.json');
    assert.deepEqual(await readProjectFile(file), JSON.parse(JSON.stringify(project)));
  });

  await test('Invalid and cyclic project files are rejected', async () => {
    await assert.rejects(readProjectFile(new File(['{"project":{}}'], 'bad.json')));
    const project = structuredClone(state().project!);
    const id = project.rootNodeIds[0]; project.nodes[id].children.push(id);
    await assert.rejects(readProjectFile(new File([JSON.stringify({project})], 'cycle.json')));
  });

  await test('Unsupported imports leave the scene intact', async () => {
    const before = state().project;
    await assert.rejects(state().importFiles([new File(['invalid'], 'not-a-model.jpg')]));
    assert.equal(state().project, before);
  });

  await test('glTF imports with missing external resources fail before changing the scene', async () => {
    const before = state().project;
    const file = new File([JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'missing.bin' }] })], 'external.gltf');
    await assert.rejects(state().importFiles([file]), /external files/);
    assert.equal(state().project, before);
  });

  await test('Starter scene has only a parametric cube and glass, with CC0 HDR lighting', () => {
    const p = state().project!;
    assert.deepEqual(Object.values(p.nodes).map(n=>n.name), ['Cube','Glass Panel']);
    assert.equal(Object.values(p.nodes).filter(n=>n.nodeType==='asset').length,2);
    const env = p.assets[p.environment.assetId!];
    assert.equal(env.sourceUri,'/assets/studio_small_09_1k.hdr');
    assert.equal(env.mimeType,'image/vnd.radiance');
    assert.equal(Object.values(p.assets).some(a=>a.catalogItemId==='gift-box'),false);
  });

  await test('The rename preserves legacy scenes and custom project names', () => {
    assert.equal(state().project!.name, 'Three Render Project');
    const legacy = structuredClone(state().project!);
    legacy.name = 'Studio Forge Project';
    state().replaceProject(legacy);
    assert.equal(state().project!.name, 'Three Render Project');
    assert.deepEqual(state().project!.nodes, legacy.nodes);
    const custom = structuredClone(state().project!); custom.name = 'My material study';
    state().replaceProject(custom);
    assert.equal(state().project!.name, custom.name);
  });

  await test('Every primitive creates finite geometry at the floor pivot', () => {
    for (const definition of PRIMITIVES) {
      const g = createPrimitiveGeometry(definition.type);
      const positions = g.getAttribute('position');
      assert.ok(positions.count>0);
      for (const number of positions.array) assert.ok(Number.isFinite(number));
      assert.ok(Math.abs(g.boundingBox!.min.y)<1e-6);
      g.dispose();
    }
  });

  await test('Parametric dimensions and subdivisions change actual geometry', () => {
    const coarse = createPrimitiveGeometry('cube',{width:.3,height:.4,depth:.5});
    const dense = createPrimitiveGeometry('cube',{width:.3,height:.4,depth:.5,widthSegments:4});
    const sizes=[coarse.boundingBox!.max.x-coarse.boundingBox!.min.x,coarse.boundingBox!.max.y,coarse.boundingBox!.max.z-coarse.boundingBox!.min.z];
    sizes.forEach((value,index)=>assert.ok(Math.abs(value-[.3,.4,.5][index])<1e-6));
    assert.ok(dense.getAttribute('position').count>coarse.getAttribute('position').count);
    coarse.dispose();dense.dispose();
    const params=normalizePrimitiveParameters('cube',{width:.1,height:.2,depth:.3,fillet:999,widthSegments:Infinity});
    assert.ok((params.fillet as number)<.05);assert.equal(params.widthSegments,1);
  });

  await test('Duplicate primitive parameters edit independently and undo restores them', () => {
    state().addPrimitive('cube');const first=state().selectedNodeId!;
    state().duplicateSelected();const second=state().selectedNodeId!;
    state().updatePrimitiveParameters(second,{width:.6});
    assert.equal(state().project!.nodes[first].primitiveParameters!.width,.2);
    assert.equal(state().project!.nodes[second].primitiveParameters!.width,.6);
    state().undo();assert.equal(state().project!.nodes[second].primitiveParameters!.width,.2);
  });

  await test('Make editable bakes serializable mesh data and preserves materials', () => {
    const id=state().project!.rootNodeIds[0];const node=state().project!.nodes[id];
    const oldMaterial=Object.values(node.materialBindings)[0];
    state().makePrimitiveEditable(id);
    const baked=state().project!.assets[state().project!.nodes[id].assetId!];
    assert.equal(baked.sourceKind,'geometry');assert.ok(baked.geometry!.data);
    const geometry=new BufferGeometryLoader().parse(JSON.parse(JSON.stringify(baked.geometry)));
    assert.ok(geometry.getAttribute('position').count>0);geometry.dispose();
    assert.equal(Object.values(state().project!.nodes[id].materialBindings)[0],oldMaterial);
    state().undo();assert.ok(state().project!.nodes[id].primitiveParameters);
  });

  await test('Numeric gestures create one undo step and Escape restores the starting value', () => {
    const id=state().selectedNodeId!;const start=state().history.past.length;
    state().beginNumericEdit();
    for(const width of [.3,.4,.5]) state().updatePrimitiveParameters(id,{width});
    assert.equal(state().history.past.length,start);
    state().endNumericEdit();assert.equal(state().history.past.length,start+1);
    state().undo();assert.equal(state().project!.nodes[id].primitiveParameters!.width,.14);
    state().beginNumericEdit();state().updatePrimitiveParameters(id,{width:.8});state().endNumericEdit(true);
    assert.equal(state().project!.nodes[id].primitiveParameters!.width,.14);
  });

  await test('Numeric formulas, units and modifier increments are bounded and safe', () => {
    assert.equal(parseNumericExpression('(2+3)*4',0),20);
    assert.equal(parseNumericExpression('+=5cm',10,100),15);
    assert.equal(parseNumericExpression('0.5m + 20mm',0,100),52);
    assert.equal(parseNumericExpression('pi rad',0,180/Math.PI),null);
    assert.equal(parseNumericExpression('1rad',0,180/Math.PI),180/Math.PI);
    for(const expression of ['window.location','1/0','2**3','','NaN','1;alert(1)']) assert.equal(parseNumericExpression(expression,0),null);
    assert.equal(adjustNumericValue(10,1,1,{shiftKey:true}),20);
    assert.equal(adjustNumericValue(10,1,1,{altKey:true}),10.1);
    assert.equal(adjustNumericValue(10,1,1,{max:10}),10);
  });

  await test('Retired built-in assets migrate without changing custom scene transforms', () => {
    const original = structuredClone(state().project!);
    const node = original.nodes[original.rootNodeIds[0]];
    const asset = original.assets[node.assetId!];
    node.name = 'Gift Box'; asset.catalogItemId = 'gift-box';
    asset.sourceKind = 'catalog'; asset.sourceUri = '/assets/gift_box.gltf';
    const environment = original.assets[original.environment.assetId!];
    environment.sourceUri = '/assets/HDRI_STUDIO_vol2_019.exr'; environment.mimeType = 'image/exr';
    const transform = structuredClone(node.transform);
    state().replaceProject(original);
    const migrated = state().project!;
    assert.equal(migrated.nodes[node.id].name, 'Cube');
    assert.deepEqual(migrated.nodes[node.id].transform, transform);
    assert.equal(migrated.assets[node.assetId!].sourceKind, 'primitive');
    assert.equal(migrated.assets[environment.id].sourceUri, '/assets/studio_small_09_1k.hdr');
  });

  await test('Dispersion packs every material at the full RGBA stride without corrupting other properties', () => {
    const materials = [0, .72, 1, NaN].map(dispersion => new MeshPhysicalMaterial({ dispersion }));
    const data = new Float32Array(materials.length * MATERIAL_STRIDE).fill(-7);
    const texture = {image: {data}, needsUpdate: false};
    const tracer = {_materials: materials, _pathTracer: {material: {materials: texture}}};
    syncSpectralDispersion(tracer as unknown as WebGLPathTracer);
    for (let i = 0; i < data.length; i++) {
      const material = Math.floor(i / MATERIAL_STRIDE);
      const expected = i % MATERIAL_STRIDE === DISPERSION_FLOAT_OFFSET ? [0, .72, 1, 0][material] : -7;
      assert.ok(Math.abs(data[i] - expected) < 1e-6, `Packed float ${i} was corrupted`);
    }
    assert.equal(texture.needsUpdate, true);
    materials.forEach(material => material.dispose());
  });

  await test('Cauchy optics preserve zero dispersion, d-line IOR and the Abbe definition', () => {
    assert.equal(abbeToDispersion(Infinity), 0);
    assert.equal(dispersionToAbbe(0), Infinity);
    for (const abbe of [20, 50, 64, 1000]) {
      const strength = abbeToDispersion(abbe);
      assert.ok(Math.abs(dispersionToAbbe(strength) - abbe) < 1e-8);
      const red = cauchyIor(1.52, strength, .6563);
      const blue = cauchyIor(1.52, strength, .4861);
      assert.ok(blue > red);
      assert.ok(Math.abs((1.52 - 1) / (blue - red) - abbe) < 1e-8);
      assert.equal(cauchyIor(1.52, strength, .5876), 1.52);
    }
    for (const wavelength of [.460, .550, .610]) assert.equal(cauchyIor(1.52, 0, wavelength), 1.52);
  });

  await test('Solid glass traces both boundaries even with zero preview thickness', () => {
    const solid = new MeshPhysicalMaterial({transmission: 1, thickness: 0});
    solid.userData.threeRenderThinWalled = false;
    const thin = solid.clone(); thin.userData.threeRenderThinWalled = true;
    const data = new Float32Array(MATERIAL_STRIDE * 2).fill(-7);
    syncSpectralDispersion({_materials: [solid, thin], _pathTracer: {material: {materials: {image: {data}}}}} as unknown as WebGLPathTracer);
    assert.equal(data[46], 0); assert.equal(data[54], 0);
    assert.equal(data[MATERIAL_STRIDE + 46], 1);
    assert.equal(data[MATERIAL_STRIDE + 54], -7);
    solid.dispose(); thin.dispose();
  });

  await test('Spectral patch matches the installed tracer and keeps a wavelength for the entire path', () => {
    const material = new PhysicalPathTracingMaterial();
    const shader = patchSpectralShader(material.fragmentShader);
    assert.equal(shader.split('int spectralChannel = -1;').length, 2);
    assert.ok(shader.includes('if ( spectralChannel < 0 )'));
    assert.ok(shader.includes('surf.thinFilm || surf.frontFace ? 1.0 / surf.ior : surf.ior'));
    assert.ok(shader.includes('surf.f0 = iorRatioToF0( surf.eta )'));
    assert.equal(shader.split('weight[ spectralChannel ] = 3.0').length, 2);
    assert.throws(() => patchSpectralShader('unsupported dependency layout'), /Unsupported/);
    material.dispose();
  });

  await test('Realtime shader initializes transmission and handles offscreen rays with the environment', () => {
    const shader = patchRealtimeTransmission(ShaderChunk.transmission_pars_fragment);
    assert.ok(shader.includes('vec4 transmittedLight = vec4( 0.0 )'));
    assert.ok(shader.includes('ndc.w > 0.0'));
    assert.ok(shader.includes('envMapRotation * direction'));
    assert.equal(shader.split('studioTransmissionSample( ndcPos').length, 3);
    assert.ok(shader.includes('studioCauchyIor( ior, dispersion, 0.460 )'));
  });

  await test('Denoise preference survives project loading and undo without changing render quality', () => {
    const original = structuredClone(state().project!);
    state().updateRendererSettings({denoise: {...original.renderer.denoise, enabled: true, applyToLive: true}});
    const saved = structuredClone(state().project!);
    assert.deepEqual(saved.renderer.render, original.renderer.render);
    state().undo(); assert.equal(state().project!.renderer.denoise.enabled, false);
    state().replaceProject(saved);
    assert.equal(state().project!.renderer.denoise.enabled, true);
    assert.equal(state().project!.renderer.denoise.applyToLive, true);
  });

  const contentWorld = (project: import('../src/core/types').ProjectDocument, id: string) => {
    const p = project.nodes[id].pivotOffset ?? [0,0,0];
    return worldMatrixForNode(project,id).multiply(new Matrix4().makeTranslation(-p[0],-p[1],-p[2]));
  };
  await test('Axis movement preserves geometry and child placement through rotated scaled parents', () => {
    state().addPrimitive('cube'); const parent=state().selectedNodeId!;
    state().updateTransform(parent,{position:[2,3,4],rotation:[.2,.4,.8],scale:[2,3,.7]},true);
    state().addPrimitive('sphere'); const id=state().selectedNodeId!;
    state().reparentNode(id,parent);
    state().updateTransform(id,{position:[.2,.3,.4],rotation:[.6,.8,.2],scale:[1.2,.4,2]},true);
    state().addPrimitive('cone'); const child=state().selectedNodeId!;state().reparentNode(child,id);
    const before=structuredClone(state().project!);
    state().setPivotOffset(id,[.06,.12,-.04]);
    close(contentWorld(before,id).elements, contentWorld(state().project!,id).elements);
    close(worldMatrixForNode(before,child).elements,worldMatrixForNode(state().project!,child).elements);
    state().undo(); assert.equal(state().project!.nodes[id].pivotOffset,undefined);
    state().redo(); assert.deepEqual(state().project!.nodes[id].pivotOffset,[.06,.12,-.04]);
  });
  await test('Axis drag creates one undo step and rotation then uses the new pivot', () => {
    state().addPrimitive('cube'); const id=state().selectedNodeId!;
    const before=structuredClone(state().project!), history=state().history.past.length;
    state().setAxisEditMode(true);
    state().updateTransform(id,{position:[.1,0,0]},false);
    state().updateTransform(id,{position:[.2,0,0]},false);
    state().updateTransform(id,{position:[.2,0,0]},true);
    assert.equal(state().history.past.length,history+1);
    close(contentWorld(before,id).elements,contentWorld(state().project!,id).elements);
    state().undo(); assert.equal(state().project!.nodes[id].pivotOffset,undefined);state().redo();
    state().setTransformMode('rotate');assert.equal(state().axisEditMode,false);
    const pivot=state().project!.nodes[id].pivotOffset!;
    const fixed=new Vector3(...pivot).applyMatrix4(contentWorld(state().project!,id));
    state().updateTransform(id,{rotation:[0,0,Math.PI/2]},true);
    close(fixed.toArray(),new Vector3(...pivot).applyMatrix4(contentWorld(state().project!,id)).toArray());
  });
  await test('Axis state survives baking, duplication and project files, and locked axes reject edits', async () => {
    state().addPrimitive('cube');const id=state().selectedNodeId!;state().setPivotOffset(id,[0,.07,0]);
    state().makePrimitiveEditable(id);assert.deepEqual(state().project!.nodes[id].pivotOffset,[0,.07,0]);
    state().duplicateSelected();const copy=state().selectedNodeId!;state().setPivotOffset(copy,[.1,.1,0]);
    assert.deepEqual(state().project!.nodes[id].pivotOffset,[0,.07,0]);
    state().toggleSelectedLock();const before=structuredClone(state().project!);state().setPivotOffset(copy,[9,9,9]);
    assert.deepEqual(state().project,before);
    const project=await readProjectFile(new File([JSON.stringify({project:before})],'axis.studio.json'));
    assert.deepEqual(project.nodes[id].pivotOffset,[0,.07,0]);
    project.nodes[id].pivotOffset=[NaN,0,0];
    await assert.rejects(readProjectFile(new File([JSON.stringify({project})],'invalid.studio.json')),/invalid/);
  });
  await test('Creating a Null adds an empty hierarchy object without changing existing nodes', () => {
    const before=structuredClone(state().project!);state().addNull();
    const node=state().project!.nodes[state().selectedNodeId!];
    assert.equal(node.nodeType,'group');assert.deepEqual(node.children,[]);
    for(const id of before.rootNodeIds)assert.deepEqual(state().project!.nodes[id],before.nodes[id]);
    state().setAxisEditMode(true);assert.equal(state().axisEditMode,false);
  });

  await test('Area beam shader retains its aperture with a collimated hard limit and matching MIS', () => {
    const material=new PhysicalPathTracingMaterial();
    const shader=patchAreaShadowShader(patchSpectralShader(material.fragmentShader));
    assert.ok(shader.includes('result.type = DIR_LIGHT_TYPE'));
    assert.ok(shader.includes('studioInsideAperture( light, aperturePoint )'));
    assert.ok(shader.includes('cosine / ( PI * sin2 )'));
    assert.ok(shader.includes('light.intensity / sin2'));
    assert.ok(shader.includes('studioAreaBeamPdf( light, dist * dist, cosTheta )'));
    assert.ok(!shader.includes('light.u * spread'));
    assert.throws(()=>patchAreaShadowShader('incompatible dependency'),/Unsupported/);
    material.dispose();
  });
  await test('Area spread packing respects light strides and preserves punctual light parameters', () => {
    const a=new ShapedAreaLight(), b=new PointLight(), c=new ShapedAreaLight();
    a.userData.studioShadowSpread=0;c.userData.studioShadowSpread=.4;
    const data=new Float32Array(72).fill(-7);packAreaShadowSpread(data,[a,b,c]);
    for(let i=0;i<data.length;i++)assert.ok(Math.abs(data[i]-(i===16?0:i===64?.4:-7))<1e-6);
    assert.equal(createLightRecord('area').shadowSpread,1);
    assert.equal(normalizeShadowSpread(undefined),1);assert.equal(normalizeShadowSpread(NaN),1);
    assert.equal(normalizeShadowSpread(-1),0);assert.equal(normalizeShadowSpread(2),1);
  });
  await test('Area shadow spread is undoable and survives project loading', async () => {
    state().addLightNode();const id=state().selectedNodeId!,node=state().project!.nodes[id];
    state().updateNode(id,{light:{...node.light!,shadowSpread:.25}});
    const saved=structuredClone(state().project!);state().undo();assert.equal(state().project!.nodes[id].light!.shadowSpread,1);
    const loaded=await readProjectFile(new File([JSON.stringify({project:saved})],'shadow.studio.json'));
    state().replaceProject(loaded);assert.equal(state().project!.nodes[id].light!.shadowSpread,.25);
  });

  console.log(`\n${passed} editor regressions passed.`);
}
