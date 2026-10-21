// Cauchy n(lambda) = A + B/lambda², anchored at the Fraunhofer d line.
// Strength 0 is nondispersive; strength 1 corresponds to Vd = 20 (dense flint).
export function dispersionToAbbe(strength: number): number {
  return strength > 0 ? 20 / Math.min(1, strength) : Infinity;
}

export function abbeToDispersion(abbe: number): number {
  return Number.isFinite(abbe) && abbe > 0 ? Math.min(1, 20 / abbe) : 0;
}

export function cauchyIor(ior: number, strength: number, wavelength: number): number {
  const b = (ior - 1) / (dispersionToAbbe(strength) * (1 / .4861 ** 2 - 1 / .6563 ** 2));
  return ior + b * (1 / wavelength ** 2 - 1 / .5876 ** 2);
}

export const CAUCHY_GLSL = /* glsl */ `
float studioCauchyIor( float baseIor, float strength, float wavelength ) {
  float b = ( baseIor - 1.0 ) * clamp( strength, 0.0, 1.0 ) / 20.0
    / ( 1.0 / ( 0.4861 * 0.4861 ) - 1.0 / ( 0.6563 * 0.6563 ) );
  return baseIor + b * ( 1.0 / ( wavelength * wavelength ) - 1.0 / ( 0.5876 * 0.5876 ) );
}
`;
