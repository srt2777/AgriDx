/** Discovery-only gate. A matching title is never proof of full-text quality. */
export function literatureExclusionReason(record: {title: string; updates?: unknown[]}): string | null {
  const title = record.title.normalize('NFKC').toLowerCase();
  if (/\b(editorial|errat(?:um|a)|corrigendum|retract(?:ed|ion)|correction|announcement|obituar|acknowledg|reviewers|contents|foreword|preface|news|conference report|book review)\b|通知|公告|征稿|目录|撤稿|勘误/.test(title)) return 'notice-or-editorial';
  if (record.updates?.length) return 'publication-update-needs-review';
  const machine = /\b(tractors?|harvesters?|combine harvesters?|threshers?|balers?|seeders?|planters?|sprayers?|ploughs?|plows?|rotavators?|rotary tillers?|power tillers?|strip.tillers?|agricultural machinery|farm machinery|agricultural machines?|farm equipment|diesel engines?|gearboxes?|tractor transmissions?|gear transmissions?|hydraulic systems?)\b|拖拉机|收获机|农机|农业机械|柴油机|变速箱|液压系统/;
  if (!machine.test(title)) return 'no-explicit-machinery-topic';
  if (title.trim().length < 25) return 'insufficient-title-context';
  return null;
}
