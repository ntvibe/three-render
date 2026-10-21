import type * as THREE from 'three';
import type { WebGLPathTracer } from 'three-gpu-pathtracer';
import { CAUCHY_GLSL } from './glassOptics';

export const MATERIAL_PIXELS = 47;
export const MATERIAL_STRIDE = MATERIAL_PIXELS * 4;
export const DISPERSION_FLOAT_OFFSET = 6 * 4 + 2;

interface InternalPathTracer {
  _materials: THREE.Material[] | null;
  _pathTracer: {
    material: THREE.ShaderMaterial & {
      materials: { image: { data: Float32Array }; needsUpdate: boolean };
    };
  };
}

function asInternal(pathTracer: WebGLPathTracer): InternalPathTracer {
  return pathTracer as unknown as InternalPathTracer;
}

export function replaceRequired(source: string, needle: string, replacement: string): string {
  const index = source.indexOf(needle);
  if (index < 0 || source.indexOf(needle, index + needle.length) !== -1) {
    throw new Error('Unsupported three-gpu-pathtracer 0.0.24 shader layout for dispersion.');
  }
  return source.slice(0, index) + replacement + source.slice(index + needle.length);
}

// One RGB wavelength is selected ONCE at the first dispersive interface and retained
// across all subsequent bounces. This is three-wavelength transport, not a full spectrum.
// Surface IOR, Fresnel, transmission directions and BSDF evaluation all use that IOR.
export function patchSpectralShader(source: string): string {
  let shader = source;
  const patch = (needle: string, replacement: string) => { shader = replaceRequired(shader, needle, replacement); };
  patch('vec2 clearcoatNormalScale;\n\t\tfloat clearcoatRoughness;',
    'vec2 clearcoatNormalScale;\n\t\tfloat dispersion;\n\t\tfloat clearcoatRoughness;');
  patch('m.clearcoatNormalScale = s6.rg;\n\n\t\tm.sheen',
    'm.clearcoatNormalScale = s6.rg;\n\t\tm.dispersion = s6.b;\n\n\t\tm.sheen');
  patch('float attenuationDistance;\n\n\t\t// clearcoat',
    'float attenuationDistance;\n\t\tfloat dispersion;\n\n\t\t// clearcoat');
  patch('surf.attenuationDistance = material.attenuationDistance;\n\n\t\tsurf.clearcoatNormal',
    'surf.attenuationDistance = material.attenuationDistance;\n\t\tsurf.dispersion = material.dispersion;\n\n\t\tsurf.clearcoatNormal');
  patch('void main() {', CAUCHY_GLSL + '\nvoid main() {');
  patch('RenderState state = initRenderState();',
    'int spectralChannel = -1;\n\t\t\t\t\tRenderState state = initRenderState();');
  patch('scatterRec = bsdfSample( - ray.direction, surf );', `
    if ( ! surf.volumeParticle && surf.transmission > 0.0 && surf.dispersion > 0.0 ) {
      if ( spectralChannel < 0 ) {
        spectralChannel = min( 2, int( floor( rand( 17 ) * 3.0 ) ) );
        // Account for the 1/3 wavelength selection probability exactly once.
        vec3 weight = vec3( 0.0 );
        weight[ spectralChannel ] = 3.0;
        state.throughputColor *= weight;
      }
      vec3 wavelengths = vec3( 0.610, 0.550, 0.460 );
      surf.ior = studioCauchyIor( surf.ior, surf.dispersion, wavelengths[ spectralChannel ] );
      surf.eta = surf.thinFilm || surf.frontFace ? 1.0 / surf.ior : surf.ior;
      surf.f0 = iorRatioToF0( surf.eta );
    }
    scatterRec = bsdfSample( - ray.direction, surf );`);
  return shader;
}

export function installSpectralDispersionShader(pathTracer: WebGLPathTracer): void {
  const material = asInternal(pathTracer)._pathTracer.material;
  if (material.userData.threeRenderSpectralDispersion) return;
  if (material.defines.MATERIAL_PIXELS !== MATERIAL_PIXELS) {
    throw new Error('Unsupported path tracer material stride for dispersion.');
  }
  material.fragmentShader = patchSpectralShader(material.fragmentShader);
  material.userData.threeRenderSpectralDispersion = true;
  material.needsUpdate = true;
}

export function syncSpectralDispersion(pathTracer: WebGLPathTracer): void {
  const internal = asInternal(pathTracer);
  const materials = internal._materials;
  if (!materials?.length) return;
  const texture = internal._pathTracer.material.materials;
  const data = texture.image.data;
  if (data.length < materials.length * MATERIAL_STRIDE) {
    throw new Error('Path tracer material buffer is too small for dispersion.');
  }
  materials.forEach((material, index) => {
    const physical = material as THREE.MeshPhysicalMaterial;
    const value = physical.dispersion;
    data[index * MATERIAL_STRIDE + DISPERSION_FLOAT_OFFSET] =
      Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    // The upstream tracer infers thin-film mode from a raster thickness of zero.
    // Studio glass has an explicit thin-walled setting; a solid mesh always needs
    // both its entry and exit interfaces, even when preview thickness is zero.
    if (physical.transmission > 0 && typeof physical.userData.threeRenderThinWalled === 'boolean') {
      const thin = physical.userData.threeRenderThinWalled;
      data[index * MATERIAL_STRIDE + 11 * 4 + 2] = Number(thin);
      if (!thin) data[index * MATERIAL_STRIDE + 13 * 4 + 2] = 0;
    }
  });
  texture.needsUpdate = true;
}
