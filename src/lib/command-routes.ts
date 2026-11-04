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
  { id: 'knowledge', path: '/knowledge', zh: '农机知识', en: 'Knowledge', hintZh: '知识目录', hintEn: 'Catalog', words: 'catalog 目录 资料' },
  { id: 'chat', path: '/chat', zh: '司稼 · 智能诊断', en: 'Sijia · Diagnosis', hintZh: '诊断', hintEn: 'Diagnosis', words: 'chat 诊断' },
  { id: 'models', path: '/models', zh: '模型工坊', en: 'Model studio', hintZh: '结构示意', hintEn: 'Structure illustration', words: 'model tractor 模型 结构' },
  { id: 'fault', path: '/fault-detection', zh: '故障检测演示', en: 'Fault detection demo', hintZh: '检测演示', hintEn: 'Detection demo', words: 'fault detection demo 故障 检测 演示' },
  { id: 'history', path: '/version-history', zh: '版本历史记录', en: 'Version history', hintZh: '更新日志', hintEn: 'Changelog', words: 'version history changelog 更新 版本 日志' },
];

export function filterCommands(query: string, routes: readonly CommandRoute[] = COMMAND_ROUTES): CommandRoute[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...routes];
  return routes.filter((item) => `${item.zh} ${item.en} ${item.hintZh} ${item.hintEn} ${item.words}`.toLowerCase().includes(needle));
}

export function statusPlace(pathname: string, lang: 'zh' | 'en'): string {
  const places: Record<string, [string, string]> = {
    '/': ['园区', 'CAMPUS'],
    '/hall': ['大厅', 'CAMPUS'],
    '/knowledge': ['知识目录', 'CATALOG'],
    '/models': ['模型工坊', 'MODEL STUDIO'],
    '/version-history': ['版本历史记录', 'VERSION HISTORY'],
    '/workspace/assets': ['农机对象', 'MACHINE OBJECTS'],
    '/workspace/data': ['数据采集', 'DATA COLLECTION'],
    '/workspace/commands': ['指令与响应', 'COMMANDS'],
    '/workspace/analytics': ['数据可视化', 'ANALYTICS'],
    '/workspace/records': ['操作记录', 'ACTIVITY'],
    '/chat': ['司稼 · 智能诊断', 'SIJIA · DIAGNOSIS'],
    '/fault-detection': ['故障检测演示', 'FAULT DETECTION'],
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
      kicker: '耕知 · 耘诊',
      title: '页面未找到',
      note: '这个地址没有对应的大厅或资料。',
    };
  }
  return {
    kicker: 'GENGZHI · YUNZHEN',
    title: 'Page not found',
    note: 'This address has no campus or catalog.',
  };
}
