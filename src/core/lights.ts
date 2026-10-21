import type { LightRecord, LightType } from './types';

export function createLightRecord(type: LightType = 'area'): LightRecord {
  const base: LightRecord = {
    type,
    shape: 'rectangle',
    color: '#fff0c8',
    intensity: 20,
    width: 1.2,
    height: 0.8,
    radius: 0.05,
    sunAngle: 0.526,
    angle: 36,
    penumbra: 0.15,
    distance: 0,
    decay: 2,
    showGizmo: true,
    shadowSpread: 1,
  };

  if (type === 'spot') {
    return {
      ...base,
      intensity: 60,
      radius: 0.03,
      angle: 32,
      penumbra: 0.18,
      distance: 0,
      decay: 2,
    };
  }

  if (type === 'point') {
    return {
      ...base,
      intensity: 45,
      radius: 0,
      distance: 0,
      decay: 2,
    };
  }

  if (type === 'sun') {
    return {
      ...base,
      intensity: 3,
      radius: 0,
      sunAngle: 0.526,
      distance: 12,
      decay: 0,
    };
  }

  return base;
}

export function normalizeShadowSpread(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 1 : Math.max(0, Math.min(1, value));
}
