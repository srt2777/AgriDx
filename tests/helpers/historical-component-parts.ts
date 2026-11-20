// October snapshots hash the original part definitions, in order. From the
// Ningbo fault-table batch onwards these five component lists have appendices.
const octoberLengths: Record<string, number> = {
  engine: 3,
  electrical: 8,
  transmission: 7,
  hydraulics: 8,
  brakes: 4,
};

export function octoberComponents<T extends {id: string; parts: unknown[]}>(components: T[]) {
  return components.map(component => ({
    ...component,
    parts: component.parts.slice(0, octoberLengths[component.id] ?? component.parts.length),
  }));
}
