import fs from 'node:fs';
import path from 'node:path';
import { isCommonDefinition, KNOWLEDGE_STAGES, type CommonFrameworkDefinition, type CommonKnowledgeFramework } from '../../shared/common-knowledge';
import type { KnowledgeChunk } from './retriever';

interface HierarchyRecord { entry_id: string; components: { component_id: string; part_ids: string[] }[] }
export interface RetrievalOrganization {
  entryComponents: Readonly<Record<string, readonly string[]>>;
  symptoms: readonly { id: string; terms: readonly string[]; componentIds: readonly string[] }[];
}
const INDEX_ROOT = path.resolve(process.cwd(), '知识库/整理后的知识库/农用拖拉机知识库');
const INFORMATION_TYPES = new Set(['资料索引', '资料核验', '机型资料', '资料缺口', '系统适用边界']);

/** Fail startup on stale mappings rather than displaying unsupported diagnostic relationships. */
export function validateCommonDefinition(value: unknown, chunks: KnowledgeChunk[], hierarchy: HierarchyRecord[], componentIds: string[]): CommonFrameworkDefinition {
  if (!isCommonDefinition(value)) throw new Error('通用框架格式无效');
  const unique = (ids: string[], label: string) => {
    if (new Set(ids).size !== ids.length) throw new Error(`通用框架编号重复：${label}`);
  };
  unique(value.systems.map(x => x.id), '系统');
  unique(value.systems.flatMap(x => x.performanceTargets.map(p => p.id)), '性能');
  unique(value.symptoms.map(x => x.id), '表现');
  unique(value.links.map(x => x.entryId), '条目');
  const systems = new Map(value.systems.map(x => [x.id, x]));
  const performances = new Map(value.systems.flatMap(x => x.performanceTargets.map(p => [p.id, x] as const)));
  const symptoms = new Map(value.symptoms.map(x => [x.id, x]));
  const byId = new Map(chunks.map(x => [x.entryId, x]));
  const associations = new Map(hierarchy.map(x => [x.entry_id, x.components]));
  for (const system of value.systems) {
    if (system.componentIds.some(id => !componentIds.includes(id))) throw new Error(`通用系统组件不存在：${system.id}`);
  }
  for (const symptom of value.symptoms) {
    if (symptom.systemIds.some(id => !systems.has(id)) || symptom.performanceIds.some(id =>
      !performances.has(id) || !symptom.systemIds.includes(performances.get(id)!.id))) {
      throw new Error(`通用表现关联无效：${symptom.id}`);
    }
  }
  for (const link of value.links) {
    const chunk = byId.get(link.entryId);
    if (!chunk || INFORMATION_TYPES.has(chunk.entryType!)) throw new Error(`通用关联不能引用资料信息或未知条目：${link.entryId}`);
    if (link.symptomIds.some(id => !symptoms.has(id)) || link.performanceIds.some(id => !performances.has(id))) {
      throw new Error(`通用关联目标不存在：${link.entryId}`);
    }
    unique(link.stages.map(x => x.id), link.entryId);
    for (const id of link.performanceIds) {
      if (!associations.get(link.entryId)?.some(x => performances.get(id)!.componentIds.includes(x.component_id))) {
        throw new Error(`通用性能与原组件不一致：${link.entryId}/${id}`);
      }
    }
    for (const id of link.symptomIds) {
      if (!symptoms.get(id)!.performanceIds.some(p => link.performanceIds.includes(p))) {
        throw new Error(`通用表现与性能不一致：${link.entryId}/${id}`);
      }
    }
    for (const stage of link.stages) {
      if (stage.evidenceTerms.some(term => !chunk.text.includes(term))) {
        throw new Error(`通用阶段没有原知识段文字依据：${link.entryId}/${stage.id}`);
      }
    }
  }
  return value;
}

export function loadCommonDefinition(chunks: KnowledgeChunk[], hierarchy: HierarchyRecord[], componentIds: string[]) {
  return validateCommonDefinition(JSON.parse(fs.readFileSync(path.join(INDEX_ROOT, '通用框架.json'), 'utf8')), chunks, hierarchy, componentIds);
}

export function commonEntryIds(definition: CommonFrameworkDefinition, symptomId: string): Set<string> {
  if (!definition.symptoms.some(x => x.id === symptomId)) throw new RangeError('当前通用框架没有该运行表现');
  return new Set(definition.links.filter(x => x.symptomIds.includes(symptomId)).map(x => x.entryId));
}

/** Called only after the catalog has validated these same hierarchy/framework inputs. */
export function buildRetrievalOrganization(hierarchy: HierarchyRecord[], definition: CommonFrameworkDefinition): RetrievalOrganization {
  const systems = new Map(definition.systems.map(system => [system.id, system]));
  return {
    entryComponents: Object.fromEntries(hierarchy.map(record => [record.entry_id,
      record.components.map(link => link.component_id)])),
    symptoms: definition.symptoms.map(symptom => ({ id: symptom.id,
      terms: [symptom.name, ...symptom.aliases],
      componentIds: [...new Set(symptom.systemIds.flatMap(id => systems.get(id)!.componentIds))],
    })),
  };
}

/** Reference presence is a collection gap measure, never an accuracy or performance coverage score. */
export function buildCommonFramework(definition: CommonFrameworkDefinition, chunks: KnowledgeChunk[], scope: 'archive' | 'model', symptomId?: string): CommonKnowledgeFramework {
  const allowedIds = new Set(chunks.map(x => x.entryId));
  const symptom = symptomId ? definition.symptoms.find(x => x.id === symptomId) : undefined;
  if (symptomId && !symptom) throw new RangeError('当前通用框架没有该运行表现');
  const links = definition.links.filter(x => allowedIds.has(x.entryId) && (!symptomId || x.symptomIds.includes(symptomId)));
  const cells = definition.systems.flatMap(system => system.performanceTargets.flatMap(target => KNOWLEDGE_STAGES.map(stageId => {
    const entryIds = links.filter(link => link.performanceIds.includes(target.id) && link.stages.some(s => s.id === stageId)).map(x => x.entryId);
    return { performanceId: target.id, stageId, status: entryIds.length ? 'references' as const : 'gap' as const, entryIds };
  })));
  return {
    schemaVersion: 1, scope, ...(symptomId ? { selectedSymptom: symptomId } : {}), systems: definition.systems, symptoms: definition.symptoms,
    questions: [...definition.questions, ...(symptom?.questions ?? [])], stages: definition.stages,
    cells, linkedEntries: links.length, gapCells: cells.filter(x => x.status === 'gap').length,
  };
}
