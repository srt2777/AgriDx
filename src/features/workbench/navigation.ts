import { Activity, BookOpen, Boxes, Database, LayoutDashboard, ListChecks, SlidersHorizontal, Tractor, ChartNoAxesCombined, MessageSquare } from 'lucide-react';
export const workbenchRoutes = [
  { path: '/', zh: '工作台总览', en: 'Overview', icon: LayoutDashboard, group: 'workspace' },
  { path: '/workspace/assets', zh: '农机对象', en: 'Machine objects', icon: Tractor, group: 'workspace' },
  { path: '/workspace/data', zh: '数据采集', en: 'Data collection', icon: Database, group: 'workspace' },
  { path: '/workspace/commands', zh: '指令与响应', en: 'Commands & responses', icon: SlidersHorizontal, group: 'workspace' },
  { path: '/workspace/analytics', zh: '数据可视化', en: 'Analytics', icon: ChartNoAxesCombined, group: 'workspace' },
  { path: '/workspace/records', zh: '操作与检查记录', en: 'Activity & checks', icon: ListChecks, group: 'workspace' },
  { path: '/chat', zh: '智能诊断', en: 'Diagnosis', icon: MessageSquare, group: 'knowledge' },
  { path: '/knowledge', zh: '农机知识', en: 'Knowledge', icon: BookOpen, group: 'knowledge' },
  { path: '/models', zh: '模型工坊', en: 'Model studio', icon: Boxes, group: 'knowledge' },
  { path: '/fault-detection', zh: '故障检测演示', en: 'Fault detection demo', icon: Activity, group: 'knowledge' },
] as const;
