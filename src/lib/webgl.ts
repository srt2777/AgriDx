export type GraphicsReason = 'loading' | 'unsupported' | 'lost';

/** True when a throwaway canvas can create the WebGL 2 context required by Three.js. The probe is released immediately. */
export function probeWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2');
    if (!context) return false;
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function bindContextLoss(canvas: HTMLCanvasElement, onLost: () => void): () => void {
  const handleLoss = (event: Event) => {
    event.preventDefault();
    onLost();
  };
  canvas.addEventListener('webglcontextlost', handleLoss);
  return () => canvas.removeEventListener('webglcontextlost', handleLoss);
}
