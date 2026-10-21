export type ModelingPhoto = { angle: string; dataUrl: string };
export type ModelingRequest = { identity: string; photos: ModelingPhoto[] };
export type ModelingStatus = {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  createdAt: string;
  message: string;
};
export type ModelingCapability = { available: boolean; engine: 'img2threejs'; message: string };
