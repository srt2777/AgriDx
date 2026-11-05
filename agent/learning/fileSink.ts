import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { DiagnosticTrajectory } from './trajectory';

/**
 * Optional offline file sink for live trajectories. Appends one JSON
 * line per trajectory to a local file. It is deliberately NOT enabled
 * by default: the diagnosis service only calls an `onTrajectory`
 * callback the host supplies, and this sink is only used when a host
 * explicitly passes it (for example, when AGENT_TRAJECTORY_FILE is set
 * in an offline run). Nothing in this PR enables it in production, and
 * the file never leaves the machine — no upload, no external call.
 *
 * The sink creates parent directories as needed and never throws into
 * the diagnosis path: callers must still guard the callback, and a
 * failed append is logged by the caller, not surfaced to the user.
 */
export function createFileTrajectorySink(filePath: string): (trajectory: DiagnosticTrajectory) => void {
  const resolved = path.resolve(filePath);
  return (trajectory: DiagnosticTrajectory): void => {
    mkdirSync(path.dirname(resolved), { recursive: true });
    appendFileSync(resolved, `${JSON.stringify(trajectory)}\n`, 'utf8');
  };
}
