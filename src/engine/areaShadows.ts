import type { Light, ShaderMaterial } from 'three';
import type { WebGLPathTracer } from 'three-gpu-pathtracer';
import { normalizeShadowSpread } from '../core/lights';
import { replaceRequired } from './spectralDispersion';

export function patchAreaShadowShader(source: string): string {
  let shader = replaceRequired(source, 'float area;\n\n\t\t// spot light fields',
    'float area;\n\t\tfloat shadowSpread;\n\n\t\t// spot light fields');
  shader = replaceRequired(shader, 'l.area = s3.a;',
    'l.area = s3.a;\n\t\tl.shadowSpread = texelFetch1D( tex, i + 4u ).r;');
  shader = replaceRequired(shader, 'bool intersectLightAtIndex(', /* glsl */ `
  float studioBeamSin2( float spread ) {
    float sine = sin( 0.5 * PI * clamp( spread, 0.0, 1.0 ) );
    return sine * sine;
  }

  bool studioInsideAperture( Light light, vec3 position ) {
    vec3 offset = position - light.position;
    vec2 uv = vec2( dot( offset, light.u ) / dot( light.u, light.u ), dot( offset, light.v ) / dot( light.v, light.v ) );
    return light.type == RECT_AREA_LIGHT_TYPE
      ? abs( uv.x ) <= 0.5 && abs( uv.y ) <= 0.5
      : dot( uv, uv ) <= 0.25;
  }

  // Both direct sampling and reflected-light MIS must use the same PDF.
  float studioAreaBeamPdf( Light light, float distSq, float cosine ) {
    float sin2 = studioBeamSin2( light.shadowSpread );
    float coneCos = sqrt( max( 0.0, 1.0 - sin2 ) );
    if ( cosine <= 0.0 || cosine < coneCos ) return 0.0;
    return light.shadowSpread < 0.35
      ? cosine / ( PI * sin2 )
      : distSq / ( light.area * cosine );
  }

  bool intersectLightAtIndex(`);
  shader = replaceRequired(shader, 'vec3 u = light.u;\n\t\tvec3 v = light.v;\n\n\t\t// check for backface', `
    bool areaLight = light.type == RECT_AREA_LIGHT_TYPE || light.type == CIRC_AREA_LIGHT_TYPE;
    if ( areaLight && light.shadowSpread <= 0.0001 ) return false;
    vec3 u = light.u;
    vec3 v = light.v;
    // check for backface`);
  shader = replaceRequired(shader,
    'lightRec.pdf = ( dist * dist ) / ( light.area * cosTheta );\n\t\t\t\tlightRec.emission = light.color * light.intensity;', `
    lightRec.pdf = studioAreaBeamPdf( light, dist * dist, cosTheta );
    if ( lightRec.pdf <= 0.0 ) return false;
    lightRec.emission = light.color * light.intensity / studioBeamSin2( light.shadowSpread );`);
  const start = shader.indexOf('\tLightRecord randomAreaLightSample(');
  const end = shader.indexOf('\tLightRecord randomSpotLightSample(', start);
  if (start < 0 || end < 0) throw new Error('Unsupported area light sampler layout.');
  return shader.slice(0, start) + /* glsl */ `
  LightRecord randomAreaLightSample( Light light, vec3 rayOrigin, vec2 ruv ) {
    float spread = clamp( light.shadowSpread, 0.0, 1.0 );
    vec3 normal = normalize( cross( light.u, light.v ) );
    LightRecord result;
    result.type = light.type;
    result.dist = 0.0;
    result.direction = normal;
    result.pdf = 0.0;
    result.emission = vec3( 0.0 );
    float planeDistance = dot( light.position - rayOrigin, normal );
    if ( planeDistance <= EPSILON ) return result;

    if ( spread <= 0.0001 ) {
      // Collimated finite aperture: back-project along the light normal.
      // The footprint stays rectangular/elliptical; it never becomes a point.
      vec3 aperturePoint = rayOrigin + normal * planeDistance;
      if ( ! studioInsideAperture( light, aperturePoint ) ) return result;
      result.type = DIR_LIGHT_TYPE;
      result.dist = planeDistance;
      result.pdf = 1.0;
      result.emission = light.color * light.intensity * PI;
      return result;
    }

    float sin2 = studioBeamSin2( spread );
    vec3 randomPos;
    if ( spread < 0.35 ) {
      // Narrow beams: sample their angular cone, then intersect the aperture.
      // Uniform aperture sampling becomes extremely noisy as spread approaches 0.
      float radius = sqrt( ruv.x * sin2 );
      float angle = ruv.y * 2.0 * PI;
      vec3 direction = normal * sqrt( max( 0.0, 1.0 - radius * radius ) )
        + normalize( light.u ) * radius * cos( angle )
        + normalize( light.v ) * radius * sin( angle );
      float cosine = dot( direction, normal );
      randomPos = rayOrigin + direction * ( planeDistance / cosine );
      if ( ! studioInsideAperture( light, randomPos ) ) return result;
    } else if ( light.type == RECT_AREA_LIGHT_TYPE ) {
      randomPos = light.position + light.u * ( ruv.x - 0.5 ) + light.v * ( ruv.y - 0.5 );
    } else {
      float radius = 0.5 * sqrt( ruv.x );
      float angle = ruv.y * 2.0 * PI;
      randomPos = light.position + radius * ( light.u * cos( angle ) + light.v * sin( angle ) );
    }
    vec3 toLight = randomPos - rayOrigin;
    float distanceSq = max( dot( toLight, toLight ), EPSILON );
    float dist = sqrt( distanceSq );
    vec3 direction = toLight / dist;
    float cosine = dot( direction, normal );
    result.dist = dist;
    result.direction = direction;
    result.pdf = studioAreaBeamPdf( light, distanceSq, cosine );
    // Integral of cos(theta) over the cone is PI*sin(thetaMax)^2.
    // Concentrate the same emitted power as the cone narrows.
    result.emission = light.color * light.intensity / sin2;
    return result;
  }

` + shader.slice(end);
}

interface LightUniforms {
  tex: {image: {data: Float32Array}; needsUpdate: boolean};
  updateFrom: (lights: Light[], iesTextures?: unknown[]) => void;
}

export function packAreaShadowSpread(data: Float32Array, lights: Light[]): void {
  if (data.length < lights.length * 24) throw new Error('Unsupported path tracer light stride.');
  lights.forEach((light, index) => {
    if ('isRectAreaLight' in light && light.isRectAreaLight) {
      data[index * 24 + 16] = normalizeShadowSpread(light.userData.studioShadowSpread);
    }
  });
}

export function installAreaShadows(pathTracer: WebGLPathTracer): void {
  const material = (pathTracer as unknown as {_pathTracer: {material: ShaderMaterial & {lights: LightUniforms}}})._pathTracer.material;
  if (material.userData.studioAreaShadows) return;
  material.fragmentShader = patchAreaShadowShader(material.fragmentShader);
  const uniforms = material.lights;
  const update = uniforms.updateFrom.bind(uniforms);
  uniforms.updateFrom = (lights, ies) => {
    update(lights, ies);
    packAreaShadowSpread(uniforms.tex.image.data, lights);
    uniforms.tex.needsUpdate = true;
  };
  material.userData.studioAreaShadows = true;
  material.needsUpdate = true;
}
