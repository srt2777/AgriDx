/**
 * Fault-tree analysis (FTA) for offline evaluation, structural layer only.
 *
 * A tree decomposes one top event (a user symptom) through OR/AND gates
 * into basic events. Basic events are only three kinds, and the kind is
 * the contract:
 *  - 'manual': backed by manual evidence ids (non-empty, enforced here).
 *  - 'user_report': a user-reported observation, always unverified.
 *  - 'unknown': a branch with no manual evidence. It is recorded as an
 *    unknown branch, never as a confirmed cause and never as a repair
 *    conclusion.
 *
 * This module is pure and deterministic: no network, no clock, no LLM
 * call, no memory write. A minimal cut set is a smallest set of basic
 * events whose joint occurrence explains the top event. Cut sets are
 * structure, not diagnosis: a cut set containing an unknown or a
 * user-reported event is not a confirmed cause, and no probability is
 * attached to any cut set. Planner question value is compared, not
 * replaced, by the cut-set count below (see faultTreeQuestionValue).
 */

import { questionValue } from './evaluation';

export type FaultTreeSource = 'manual' | 'user_report' | 'unknown';

export interface FaultTreeNode {
  id: string;
  label: string;
  kind: 'basic' | 'or' | 'and';
  /** Required for basic events; gates carry no source of their own. */
  source?: FaultTreeSource;
  /** Required and non-empty for manual basic events; empty otherwise. */
  evidenceIds?: readonly string[];
  /** Required and non-empty for or/and gates; forbidden for basic events. */
  children?: readonly FaultTreeNode[];
}

export interface FaultTreeBasicEvent {
  id: string;
  label: string;
  source: FaultTreeSource;
  evidenceIds: readonly string[];
  /** Manual events carry evidence; user reports are never verified. */
  verification: 'manual' | 'unverified' | 'unknown';
}

export interface FaultTreeCutSet {
  events: string[];
  hasUnknown: boolean;
  hasUserReport: boolean;
  /** True only when every event is manual with evidence ids. */
  fullyManual: boolean;
}

export interface FaultTreeAnalysis {
  topEventId: string;
  basicEvents: FaultTreeBasicEvent[];
  cutSets: FaultTreeCutSet[];
  /** Cut sets that may be quoted as manual-backed structure only. */
  fullyManualCutSets: string[][];
  /** Cut sets containing at least one unknown branch. */
  unknownCutSets: string[][];
}

function compareSets(a: readonly string[], b: readonly string[]): number {
  if (a.length !== b.length) return a.length - b.length;
  const joinedA = a.join('|');
  const joinedB = b.join('|');
  return joinedA < joinedB ? -1 : joinedA > joinedB ? 1 : 0;
}

function normalizeSet(events: Iterable<string>): string[] {
  return [...new Set(events)].sort();
}

function minimize(sets: readonly (readonly string[])[]): string[][] {
  const normalized = sets.map((set) => normalizeSet(set));
  const unique = new Map<string, string[]>();
  for (const set of normalized) unique.set(set.join('|'), set);
  const list = [...unique.values()];
  const minimal = list.filter(
    (candidate) =>
      !list.some(
        (other) =>
          other !== candidate &&
          other.length < candidate.length &&
          other.every((event) => candidate.includes(event)),
      ),
  );
  return minimal.sort(compareSets);
}

function collectBasicEvents(
  node: FaultTreeNode,
  events: Map<string, FaultTreeBasicEvent>,
  visiting: Set<string>,
): void {
  if (node.kind === 'basic') {
    if (node.children?.length) {
      throw new TypeError(`Fault-tree basic event ${node.id} must not have children`);
    }
    if (node.source === undefined) {
      throw new TypeError(`Fault-tree basic event ${node.id} requires a source`);
    }
    if (node.source === 'manual' && !(node.evidenceIds?.length)) {
      throw new TypeError(
        `Fault-tree manual basic event ${node.id} requires non-empty evidenceIds`,
      );
    }
    if (node.source !== 'manual' && (node.evidenceIds?.length ?? 0) > 0) {
      throw new TypeError(
        `Fault-tree ${node.source} basic event ${node.id} must not carry evidenceIds`,
      );
    }
    const event: FaultTreeBasicEvent = {
      id: node.id,
      label: node.label,
      source: node.source,
      evidenceIds: node.evidenceIds ?? [],
      verification:
        node.source === 'manual'
          ? 'manual'
          : node.source === 'user_report'
            ? 'unverified'
            : 'unknown',
    };
    const previous = events.get(node.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(event)) {
      throw new TypeError(`Fault-tree basic event ${node.id} is defined inconsistently`);
    }
    events.set(node.id, event);
    return;
  }
  if (!node.children?.length) {
    throw new TypeError(`Fault-tree gate ${node.id} requires non-empty children`);
  }
  if (visiting.has(node.id)) {
    throw new TypeError(`Fault-tree gate ${node.id} forms a cycle`);
  }
  visiting.add(node.id);
  for (const child of node.children) collectBasicEvents(child, events, visiting);
  visiting.delete(node.id);
}

function cutSetsOf(node: FaultTreeNode, visiting: Set<string>): string[][] {
  if (node.kind === 'basic') return [[node.id]];
  if (!node.children?.length) {
    throw new TypeError(`Fault-tree gate ${node.id} requires non-empty children`);
  }
  if (visiting.has(node.id)) {
    throw new TypeError(`Fault-tree gate ${node.id} forms a cycle`);
  }
  visiting.add(node.id);
  try {
    if (node.kind === 'or') {
      const combined: string[][] = [];
      for (const child of node.children) combined.push(...cutSetsOf(child, visiting));
      return minimize(combined);
    }
    // AND gate: Cartesian product of the children's cut sets.
    let combined: string[][] = [[]];
    for (const child of node.children) {
      const childSets = cutSetsOf(child, visiting);
      const next: string[][] = [];
      for (const existing of combined) {
        for (const childSet of childSets) next.push(normalizeSet([...existing, ...childSet]));
      }
      combined = next;
    }
    return minimize(combined);
  } finally {
    visiting.delete(node.id);
  }
}

/** Full fault-tree analysis for one top event. */
export function analyzeFaultTree(root: FaultTreeNode): FaultTreeAnalysis {
  const events = new Map<string, FaultTreeBasicEvent>();
  collectBasicEvents(root, events, new Set());
  const rawCutSets = cutSetsOf(root, new Set());
  const cutSets: FaultTreeCutSet[] = rawCutSets.map((eventsInSet) => {
    const basics = eventsInSet.map((id) => events.get(id)!);
    return {
      events: eventsInSet,
      hasUnknown: basics.some((event) => event.source === 'unknown'),
      hasUserReport: basics.some((event) => event.source === 'user_report'),
      fullyManual: basics.every((event) => event.source === 'manual'),
    };
  });
  return {
    topEventId: root.id,
    basicEvents: [...events.values()].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    ),
    cutSets,
    fullyManualCutSets: cutSets
      .filter((set) => set.fullyManual)
      .map((set) => set.events),
    unknownCutSets: cutSets
      .filter((set) => set.hasUnknown)
      .map((set) => set.events),
  };
}

/** Minimal cut sets only, as sorted event-id lists. */
export function minimalCutSets(root: FaultTreeNode): string[][] {
  return analyzeFaultTree(root).cutSets.map((set) => set.events);
}

/**
 * How many minimal cut sets an observation about `eventId` distinguishes:
 * if the event is reported normal, every cut set containing it is
 * eliminated, so this count is also the number eliminated in that case.
 * This is a count of structural explanations, not a probability and
 * not a fault likelihood; it is compared with, never substituted for,
 * the Planner ranking in faultTreeQuestionComparison.
 */
export function faultTreeQuestionValue(
  eventId: string,
  cutSets: readonly (readonly string[])[],
): number {
  return cutSets.filter((set) => set.includes(eventId)).length;
}

/**
 * Side-by-side reading of the two rankings for one observation: the
 * fault-tree count above and the existing Planner ratio
 * discriminationValue / (1 + cost). They need not agree: the Planner
 * ratio ranks a manually reviewed step template, while the cut-set
 * count measures how many structural explanations the observation
 * separates. A disagreement is a prompt to review the template, not a
 * reason to override either ranking automatically.
 */
export function faultTreeQuestionComparison(
  eventId: string,
  cutSets: readonly (readonly string[])[],
  discriminationValue: number,
  cost: number,
): {
  eventId: string;
  cutSetsContaining: number;
  cutSetsEliminatedIfNormal: number;
  cutSetsRemainingIfNormal: number;
  plannerQuestionValue: number;
} {
  const containing = faultTreeQuestionValue(eventId, cutSets);
  return {
    eventId,
    cutSetsContaining: containing,
    cutSetsEliminatedIfNormal: containing,
    cutSetsRemainingIfNormal: cutSets.length - containing,
    plannerQuestionValue: questionValue(discriminationValue, cost),
  };
}
