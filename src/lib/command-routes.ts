export interface CommandRoute {
  id: string;
  path: string;
  zh: string;
  en: string;
  hintZh: string;
  hintEn: string;
  words: string;
}

export const COMMAND_ROUTES: readonly CommandRoute[] = [
  { id: 'hub', path: '/', zh: '大厅', en: 'Hub', hintZh: '园区', hintEn: 'Campus', words: 'home campus hall equipment twin 园区 首页 装备 展厅 孪生' },
  { id: 'knowledge', path: '/knowledge', zh: '知识库', en: 'Knowledge base', hintZh: '知识目录', hintEn: 'Catalog', words: 'catalog 目录 资料' },
  { id: 'chat', path: '/chat', zh: '司稼 · 智能诊断', en: 'Sijia · Diagnosis', hintZh: '诊断', hintEn: 'Diagnosis', words: 'chat 诊断' },
  { id: 'models', path: '/models', zh: '模型工坊', en: 'Model studio', hintZh: '结构示意', hintEn: 'Structure illustration', words: 'model tractor 模型 结构' },
  { id: 'fault', path: '/fault-detection', zh: '故障检测演示', en: 'Fault detection demo', hintZh: '检测演示', hintEn: 'Detection demo', words: 'fault detection demo 故障 检测 演示' },
  { id: 'assets', path: '/workspace/assets', zh: '农机对象', en: 'Machine objects', hintZh: '资料与演示台账', hintEn: 'Evidence and demo register', words: 'farm field fleet 作业 农场 台账 机组' },
  { id: 'data', path: '/workspace/data', zh: '数据中心', en: 'Data center', hintZh: '采集、导入与可视化', hintEn: 'Collect, import and visualize', words: 'data analytics 数据 采集 分析 趋势 可视化' },
  { id: 'commands', path: '/workspace/commands', zh: '指令与响应', en: 'Commands & responses', hintZh: '任务与响应', hintEn: 'Tasks and responses', words: 'commands 指令 控制' },
  { id: 'records', path: '/workspace/records', zh: '操作与检查记录', en: 'Activity & checks', hintZh: '操作轨迹与复核', hintEn: 'Activity and review', words: 'records 记录 检查 复核' },
  { id: 'showroom', path: '/showroom', zh: '3D 展示大厅', en: 'Showroom', hintZh: '展厅漫游', hintEn: 'Showroom walkthrough', words: 'showroom hall 3d 展厅 漫游 展示' },
  { id: 'history', path: '/version-history', zh: '版本历史记录', en: 'Version history', hintZh: '更新日志', hintEn: 'Changelog', words: 'version history changelog 更新 版本 日志' },
  { id: 'cognitive-twin', path: '/cognitive-twin', zh: '发动机过热 · 认知孪生', en: 'Overheating cognitive twin', hintZh: '证据与反馈原型', hintEn: 'Evidence prototype', words: '认知 数字 孪生 过热 温度 twin overheating' },
];

export function filterCommands(query: string, routes: readonly CommandRoute[] = COMMAND_ROUTES): CommandRoute[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...routes];
  return routes.filter((item) => `${item.zh} ${item.en} ${item.hintZh} ${item.hintEn} ${item.words}`.toLowerCase().includes(needle));
}

export function statusPlace(pathname: string, lang: 'zh' | 'en'): string {
  const places: Record<string, [string, string]> = {
    '/': ['大厅', 'HUB'],
    '/hall': ['大厅', 'HUB'],
    '/knowledge': ['知识库', 'KNOWLEDGE'],
    '/models': ['模型工坊', 'MODEL STUDIO'],
    '/version-history': ['版本历史记录', 'VERSION HISTORY'],
    '/field-overview': ['农机对象', 'MACHINE OBJECTS'],
    '/workspace/assets': ['农机对象', 'MACHINE OBJECTS'],
    '/workspace/data': ['数据中心', 'DATA CENTER'],
    '/workspace/commands': ['指令与响应', 'COMMANDS'],
    '/workspace/analytics': ['数据中心', 'DATA CENTER'],
    '/workspace/records': ['操作记录', 'ACTIVITY'],
    '/cognitive-twin': ['发动机过热 · 认知孪生', 'COGNITIVE TWIN'],
    '/chat': ['司稼 · 智能诊断', 'SIJIA · DIAGNOSIS'],
    '/fault-detection': ['故障检测演示', 'FAULT DETECTION'],
    '/showroom': ['3D 展示大厅', 'SHOWROOM'],
  };
  const pair = places[pathname] ?? ['未找到', 'NOT FOUND'];
  return lang === 'zh' ? pair[0] : pair[1];
}

export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent('agridx-command-open'));
}

export function notFoundCopy(lang: 'zh' | 'en') {
  if (lang === 'zh') {
    return {
      kicker: '司稼',
      title: '页面未找到',
      note: '这个地址没有对应的大厅或资料。',
    };
  }
  return {
    kicker: 'SIJIA',
    title: 'Page not found',
    note: 'This address has no campus or catalog.',
  };
}
