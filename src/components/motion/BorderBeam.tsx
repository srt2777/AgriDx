/** Soft riding glow along a selected card or chip. The spin stops when motion is reduced. */
export function BorderBeam() {
  return (
    <span className="border-beam" data-motion="border-beam" aria-hidden="true">
      <span className="border-beam-spin" />
    </span>
  );
}
