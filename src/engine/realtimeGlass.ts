import { ShaderChunk, type MeshPhysicalMaterial } from 'three';
import { CAUCHY_GLSL } from './glassOptics';
import { replaceRequired } from './spectralDispersion';

// Raster preview still uses screen-space transmission. Off-screen rays fall back
// to the studio environment instead of projecting behind the camera or sampling
// the framebuffer border. Live/Render trace the actual entry and exit surfaces.
export function patchRealtimeTransmission(source: string): string {
  let shader = replaceRequired(source,
    'vec4 getIBLVolumeRefraction(',
    CAUCHY_GLSL + `
vec4 studioTransmissionSample( vec4 ndc, vec2 uv, vec3 direction, float roughness, float ior ) {
  vec4 screen = getTransmissionSample( clamp( uv, vec2( 0.0 ), vec2( 1.0 ) ), roughness, ior );
  #if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
    vec3 environment = textureCubeUV( envMap, envMapRotation * direction, roughness ).rgb * envMapIntensity;
    vec2 edge = min( uv, vec2( 1.0 ) - uv );
    float visibility = ndc.w > 0.0 ? smoothstep( 0.0, 0.03, min( edge.x, edge.y ) ) : 0.0;
    return mix( vec4( environment, 1.0 ), screen, visibility );
  #else
    return screen;
  #endif
}
vec4 getIBLVolumeRefraction(`);
  shader = replaceRequired(shader, 'vec4 transmittedLight;', 'vec4 transmittedLight = vec4( 0.0 );');
  shader = replaceRequired(shader,
    'float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;\n\t\t\tvec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );',
    'vec3 iors = vec3( studioCauchyIor( ior, dispersion, 0.610 ), studioCauchyIor( ior, dispersion, 0.550 ), studioCauchyIor( ior, dispersion, 0.460 ) );');
  shader = replaceRequired(shader,
    'getTransmissionSample( refractionCoords, roughness, iors[ i ] )',
    'studioTransmissionSample( ndcPos, refractionCoords, normalize( refract( -v, normalize( n ), 1.0 / iors[ i ] ) ), roughness, iors[ i ] )');
  shader = replaceRequired(shader,
    'getTransmissionSample( refractionCoords, roughness, ior )',
    'studioTransmissionSample( ndcPos, refractionCoords, normalize( refract( -v, normalize( n ), 1.0 / ior ) ), roughness, ior )');
  return shader;
}

const transmissionShader = patchRealtimeTransmission(ShaderChunk.transmission_pars_fragment);
export function installRealtimeGlassShader(material: MeshPhysicalMaterial): void {
  if (material.userData.threeRenderGlass) return;
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <transmission_pars_fragment>', transmissionShader);
  };
  material.customProgramCacheKey = () => 'studio-glass-cauchy-v1';
  material.userData.threeRenderGlass = true;
  material.needsUpdate = true;
}
