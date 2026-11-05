import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildSyntheticDataset } from '../agent/learning/synthetic';
import { exportSftDataset } from '../agent/learning/sft';
import { isMain, main, rootDir } from './lib/process.mjs';

/**
 * Offline SFT dataset generator.
 *
 * Builds the synthetic good-trajectory dataset from existing Planner
 * topics / fault chains / evidence IDs (see agent/learning/synthetic.ts
 * for the provenance note), scores every candidate with the reward
 * scorer, and writes only the trajectories that pass the good gate to
 * agent/learning/data/sft-good-trajectories.jsonl.
 *
 * No model call, no training, no network. Rejected candidates are
 * reported, never padded up to a round number.
 */
export function generateSftDataset(): void {
  const outPath = path.join(rootDir, 'agent', 'learning', 'data', 'sft-good-trajectories.jsonl');
  const result = buildSyntheticDataset();
  const jsonl = exportSftDataset(result.examples);
  writeFileSync(outPath, jsonl, 'utf8');
  console.log(`candidates: ${result.candidates}`);
  console.log(`kept: ${result.kept}`);
  console.log(`rejected: ${result.rejected.length}`);
  for (const item of result.rejected) {
    console.log(`  rejected ${item.id}: total=${item.total} flags=${item.flags.join(',')}`);
  }
  console.log(`by topic: ${JSON.stringify(result.byTopic)}`);
  console.log(`wrote ${outPath} (${result.kept} examples)`);
  if (result.kept < 50) {
    console.warn(`WARNING: only ${result.kept} good trajectories (target 50-100); do not pad manually, fix the generator or the reward rules first.`);
  }
}

if (isMain(import.meta.url)) main(generateSftDataset, 'generate-sft-dataset');
