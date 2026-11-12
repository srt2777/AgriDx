import { Activity, BookOpen, Boxes, Database, LayoutDashboard, ListChecks, SlidersHorizontal, Tractor, MessageSquare } from 'lucide-react';
export const workbenchRoutes = [
  { path: '/', zh: '工作台总览', en: 'Overview', icon: LayoutDashboard, group: 'workspace' },
  { path: '/workspace/assets', zh: '农机对象', en: 'Machine objects', icon: Tractor, group: 'workspace' },
  { path: '/workspace/data', zh: '数据中心', en: 'Data center', icon: Database, group: 'workspace' },
  { path: '/workspace/commands', zh: '指令与响应', en: 'Commands & responses', icon: SlidersHorizontal, group: 'workspace' },
  { path: '/workspace/records', zh: '操作与检查记录', en: 'Activity & checks', icon: ListChecks, group: 'workspace' },
  { path: '/chat', zh: '司稼 · 智能诊断', en: 'Sijia · Diagnosis', icon: MessageSquare, group: 'knowledge' },
  { path: '/knowledge', zh: '知识库', en: 'Knowledge base', icon: BookOpen, group: 'knowledge' },
  { path: '/models', zh: '模型工坊', en: 'Model studio', icon: Boxes, group: 'knowledge' },
  { path: '/fault-detection', zh: '故障检测演示', en: 'Fault detection demo', icon: Activity, group: 'knowledge' },
] as const;
