import type { TaxonomyNode } from './knowledge-taxonomy-data';

/** 初始聚合视图（品牌 + 机型）最多显示的节点数；真实目录为 168 个。 */
export const MAX_INITIAL_NODES = 240;
/** 渐进展开后全图最多显示的节点数；绝不一次渲染数千节点。 */
export const MAX_TOTAL_NODES = 600;
/** 深层节点（部件 / 零件）显示文字标签的节点总数上限。 */
export const LABEL_NODE_LIMIT = 120;

export interface ForceGraphNode {
  id: string;
  label: string;
  level: TaxonomyNode['level'];
  count: number;
  color: string;
  /** 相对尺寸，供力导向图的 nodeVal 使用。 */
  val: number;
  query: Record<string, string>;
  childrenCount: number;
  hasChildren: boolean;
}

export interface ForceGraphLink {
  source: string;
  target: string;
}

export interface ForceGraphData {
  nodes: ForceGraphNode[];
  links: ForceGraphLink[];
  /** 因节点上限而省略了可显示节点。 */
  truncated: boolean;
  omitted: number;
  /** 传入的目录节点总数（过滤后），与当前显示数区分。 */
  totalAvailable: number;
}

/** 旧版暖色：品牌米白、机型金、部件珊瑚、零件鼠尾草绿。 */
export function levelColor(level: TaxonomyNode['level']): string {
  switch (level) {
    case 'brand': return '#efe6d0';
    case 'model': return '#d9a441';
    case 'component': return '#e2725b';
    case 'part': return '#7fa88f';
  }
}

export function nodeSize(node: Pick<ForceGraphNode, 'level' | 'count'>): number {
  switch (node.level) {
    case 'brand': return 10;
    case 'model': return 6 + Math.min(2, Math.log10(node.count + 1));
    case 'component': return 4;
    case 'part': return 2.5;
  }
}

/** 品牌与机型始终显示文字；深层节点只在图较小时显示，避免拥挤。 */
export function labelVisible(node: ForceGraphNode, totalNodes: number): boolean {
  if (node.level === 'brand' || node.level === 'model') return true;
  return totalNodes <= LABEL_NODE_LIMIT;
}

export function findGraphNode(data: ForceGraphData, id: string): ForceGraphNode | undefined {
  return data.nodes.find(node => node.id === id);
}

export interface BuildForceGraphOptions {
  /** 已展开的节点 id；其直接下级会加入图中。 */
  expandedIds?: Iterable<string>;
  maxInitialNodes?: number;
  maxTotalNodes?: number;
}

/**
 * 由目录节点构造力导向图数据：初始只放品牌与机型两层聚合节点，
 * 再按 expandedIds 逐层加入下级；始终保留父链、按目录顺序加入、
 * 超过上限时截断并报告省略数。输入不被改动。
 */
export function buildForceGraphData(nodes: TaxonomyNode[], options: BuildForceGraphOptions = {}): ForceGraphData {
  const maxInitial = options.maxInitialNodes ?? MAX_INITIAL_NODES;
  const maxTotal = options.maxTotalNodes ?? MAX_TOTAL_NODES;
  const byId = new Map(nodes.map(node => [node.id, node]));
  const childrenOf = new Map<string, TaxonomyNode[]>();
  for (const node of nodes) {
    if (!node.parent) continue;
    const list = childrenOf.get(node.parent) ?? [];
    list.push(node);
    childrenOf.set(node.parent, list);
  }
  const included = new Map<string, ForceGraphNode>();
  let omitted = 0;
  const toForceNode = (node: TaxonomyNode): ForceGraphNode => ({
    id: node.id,
    label: node.label,
    level: node.level,
    count: node.count,
    color: levelColor(node.level),
    val: nodeSize({ level: node.level, count: node.count }),
    query: node.query,
    childrenCount: childrenOf.get(node.id)?.length ?? 0,
    hasChildren: (childrenOf.get(node.id)?.length ?? 0) > 0,
  });
  for (const node of nodes) {
    if (node.level !== 'brand' && node.level !== 'model') continue;
    if (included.size >= maxInitial) { omitted += 1; continue; }
    included.set(node.id, toForceNode(node));
  }
  const ensureAncestors = (node: TaxonomyNode): boolean => {
    const chain: TaxonomyNode[] = [];
    let current: TaxonomyNode | undefined = node;
    while (current && !included.has(current.id)) {
      chain.unshift(current);
      current = current.parent ? byId.get(current.parent) : undefined;
    }
    for (const item of chain) {
      if (included.size >= maxTotal) return false;
      included.set(item.id, toForceNode(item));
    }
    return true;
  };
  for (const expandedId of options.expandedIds ?? []) {
    const target = byId.get(expandedId);
    if (!target) continue;
    if (!ensureAncestors(target)) continue;
    for (const child of childrenOf.get(target.id) ?? []) {
      if (included.has(child.id)) continue;
      if (included.size >= maxTotal) { omitted += 1; continue; }
      included.set(child.id, toForceNode(child));
    }
  }
  const outNodes = nodes.filter(node => included.has(node.id)).map(node => included.get(node.id)!);
  const links: ForceGraphLink[] = [];
  for (const node of nodes) {
    if (!node.parent) continue;
    if (!included.has(node.id) || !included.has(node.parent)) continue;
    links.push({ source: node.parent, target: node.id });
  }
  return { nodes: outNodes, links, truncated: omitted > 0, omitted, totalAvailable: nodes.length };
}
