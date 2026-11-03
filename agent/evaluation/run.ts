/**
 * Offline evaluation entry point. Run from the repository root:
 *
 *   npx tsx agent/evaluation/run.ts
 *   npx tsx agent/evaluation/run.ts --json
 *
 * No network, no model call, no key, no memory write. The `--json`
 * form prints only the machine-readable report; the default form
 * prints one line per case followed by the aggregate as JSON.
 */
import { runOfflineEvaluation } from './runner';

const report = runOfflineEvaluation();
const jsonOnly = process.argv.includes('--json');
if (jsonOnly) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const result of report.cases) {
    const ai = result.ai
      ? ` ai score=${result.ai.score.toFixed(3)} veto=${result.ai.veto} reasons=${result.ai.vetoReasons.join(',') || '-'}`
      : '';
    console.log(
      `${result.id} route=${result.route} reason=${result.reason} ` +
        `expected=${result.expectedRoute ?? '-'}:${result.expectedReason ?? '-'} ` +
        `match=${result.routeMatchesExpectation} ` +
        `local score=${result.local.score.toFixed(3)} veto=${result.local.veto} ` +
        `reasons=${result.local.vetoReasons.join(',') || '-'} ` +
        `evidence=${result.local.breakdown.evidence_score.toFixed(2)} ` +
        `coverage=${result.local.breakdown.coverage_score.toFixed(2)} ` +
        `rel=${result.local.breakdown.relevance_score.toFixed(2)}(${result.relevanceSource}:${result.relevanceLevel}${result.relevanceMembershipHigh === null ? '' : `,mu=${result.relevanceMembershipHigh.toFixed(2)}`}) ` +
        `winner=${result.winnerId ?? 'keep-current'}${ai}`,
    );
  }
  console.log(JSON.stringify(report.aggregate, null, 2));
}
