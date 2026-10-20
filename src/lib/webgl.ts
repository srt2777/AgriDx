export type GraphicsReason = 'loading' | 'unsupported' | 'lost';

/** True when a throwaway canvas can create a WebGL context. The probe is released immediately. */
export function probeWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!context) return false;
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function bindContextLoss(canvas: HTMLCanvasElement, onLost: () => void): void {
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    onLost();
  });
}
