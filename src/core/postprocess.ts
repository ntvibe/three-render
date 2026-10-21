import type { PostprocessStage, RenderFrame } from './types';

// Extension point. The active GPU denoiser in EditorEngine needs no neural weights.
export class PostprocessPipeline {
  private stages: PostprocessStage[] = [];
  setStages(stages: PostprocessStage[]): void { this.stages = stages; }
  getStages(): PostprocessStage[] { return this.stages; }
  async process(frame: RenderFrame): Promise<RenderFrame> {
    let nextFrame = frame;
    for (const stage of this.stages) {
      if (stage.enabled) nextFrame = await stage.process(nextFrame);
    }
    return nextFrame;
  }
}

export function createNoopDenoiseStage(): PostprocessStage {
  return { id: 'noop-denoise', name: 'Denoise extension', kind: 'denoise', enabled: false,
    async process(frame) { return frame; } };
}
