export type TractorView = 'isometric' | 'front' | 'side' | 'top';
export const TRACTOR_VIEWS: { id: TractorView; zh: string; en: string; direction: [number, number, number] }[] = [
  { id: 'isometric', zh: '总览', en: 'Overview', direction: [-1, .62, 1] },
  { id: 'front', zh: '正面', en: 'Front', direction: [-1, .12, 0] },
  { id: 'side', zh: '侧面', en: 'Side', direction: [0, .12, 1] },
  { id: 'top', zh: '俯视', en: 'Top', direction: [.01, 1, .01] },
];
