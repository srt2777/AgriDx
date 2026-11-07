import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '');
const css = stripComments(read('../src/new-version-mobile-harmony.css'));
const entry = read('../src/index.tsx');

/* 新版手机端协调层：只允许新版壳内的规则，旧版（classic）一个字都不能碰。 */
test('手机端协调层只作用于新版，不碰旧版', () => {
  assert.ok(css.includes("[data-ui-version='new']"), '规则必须以新版 data-ui-version 为作用域');
  assert.ok(!css.includes("[data-ui-version='old']"), '不得出现旧版作用域');
  assert.ok(!css.includes('.fluid-workspace'), '不得出现旧版 workspace 选择器');
  assert.ok(!css.includes('!important'), '协调层不靠 !important，靠作用域与加载顺序取胜');
});

test('协调层在入口最后加载，覆盖 unify / mechanical / chat-layout', () => {
  const importLine = "import './new-version-mobile-harmony.css';";
  assert.ok(entry.includes(importLine), 'index.tsx 必须引入协调层');
  const order = [
    './new-version-unify.css',
    './new-version-mechanical.css',
    './pages/ChatPage/chat-layout.css',
    './new-version-mobile-harmony.css',
  ];
  const positions = order.map(name => entry.indexOf(`import '${name}';`));
  assert.ok(positions.every(position => position >= 0), '入口必须包含全部四个样式文件');
  assert.ok(
    positions[0] < positions[1] && positions[1] < positions[2] && positions[2] < positions[3],
    '协调层必须在 unify、mechanical、chat-layout 之后加载',
  );
});

/* 竖屏（<=600px）：向旧版节奏收敛 —— 标题 24px、正文 14px/1.6、标题字距 0。 */
test('竖屏断点把新版字号收敛到旧版节奏', () => {
  assert.ok(css.includes('@media (max-width: 600px)'), '必须有竖屏 <=600px 断点');
  const portrait = css.slice(css.indexOf('@media (max-width: 600px)'));
  assert.ok(portrait.includes('--nv-text-xl: 24px'), 'h1 从 32px 收到旧版的 24px');
  assert.ok(portrait.includes('--nv-text-md: 14px'), '正文从 16px 收到旧版的 14px');
  assert.ok(portrait.includes('--nv-text-leading: 1.6'), '正文行高从 1.5 收到旧版的 1.6');
  assert.ok(portrait.includes('--nv-heading-leading: 1.35'), '标题行高从 1.25 收到旧版的 1.35');
  assert.ok(portrait.includes('letter-spacing: 0'), '标题去掉 -0.03em 字距，回到旧版的 0');
});

test('竖屏断点收紧页头与页面顶部留白', () => {
  const portrait = css.slice(css.indexOf('@media (max-width: 600px)'));
  assert.ok(portrait.includes('.new-version-nav-toggle'), '导航开关要收进页头，不再悬浮压住正文');
  assert.ok(portrait.includes('top: 16px'), '导航开关固定到页头第一行高度');
  assert.ok(portrait.includes('padding: 6px 8px 6px 48px'), '页头给收进来的开关留出 48px');
  assert.ok(portrait.includes('.knowledge-page .page-container'), '知识页容器顶部留白要收紧');
  assert.ok(portrait.includes('padding-top: 8px'), '知识页容器顶部留白收到 8px');
  assert.ok(portrait.includes('.catalog-stats strong'), '知识统计大数字要收小');
  assert.ok(portrait.includes('.ui-version-switch {\n    padding: 2px;'), '版本切换胶囊内边距收到 2px，容器与工具按钮齐平');
});

test('竖屏断点把首页三维舞台从 780px 收短', () => {
  const portrait = css.slice(css.indexOf('@media (max-width: 600px)'));
  assert.ok(portrait.includes('.expo-world-stage'), '必须覆盖首页舞台');
  assert.ok(portrait.includes('56svh'), '舞台高度改为 56svh，不再占满一屏');
  assert.ok(portrait.includes('.expo-hero strong'), '舞台内大标题也要收小');
  assert.ok(portrait.includes('.expo-world-dock > button'), '首页 dock 按钮要收紧，避免“驾驶漫游”被挤压裁切');
  assert.ok(portrait.includes('padding-inline: 4px'), 'dock 按钮内边距收到 4px');
  assert.ok(portrait.includes('font-size: 11px'), 'dock 按钮字号回到原设计的 11px（unify 通则提到了 14px 才挤爆容器）');
});

/* 横屏（高度很矮）：舞台、对话空态、页头都要在 390px 高度内放得下。 */
test('横屏断点覆盖舞台与对话空态', () => {
  const landscapeQuery = '@media (orientation: landscape) and (max-height: 500px)';
  assert.ok(css.includes(landscapeQuery), '必须有横屏矮视口断点');
  const landscape = css.slice(css.indexOf(landscapeQuery));
  assert.ok(landscape.includes('.expo-world-stage'), '横屏也要收短舞台');
  assert.ok(landscape.includes('68svh'), '横屏舞台高度改为 68svh');
  assert.ok(landscape.includes('.chat-empty'), '横屏要压缩对话空态');
  assert.ok(landscape.includes('margin-top: 8px'), '对话空态顶部留白收到 8px');
  assert.ok(landscape.includes('grid-template-columns: repeat(4, minmax(0, 1fr))'), '横屏快捷提问改为 4 列 1 行，让标题回到可视区');
  assert.ok(landscape.includes('.chat-empty > p.mt-4'), '横屏空态段间距收紧，标题顶回可视区');
  assert.ok(landscape.includes('.new-version-nav-toggle'), '横屏页头同样收进导航开关');
});

/* 对话页是 100dvh 的 flex 布局，底部留白规则不能动它。 */
test('收起导航时的底部留白不作用于对话页', () => {
  assert.ok(
    css.includes(":not([data-route='/chat'])"),
    '底部留白规则必须排除对话页（对话页 workspace padding-bottom 为 0）',
  );
});

/* 本 PR 不 bump 项目版本：4.0.41 已被 PR2/3/4 占用，版本号留待合并时协调。 */
test('协调层不带任何版本号', () => {
  assert.ok(!css.includes('4.0.41'), '不得出现 4.0.41');
  assert.ok(!css.includes('4.0.40'), '不得出现 4.0.40');
});

/* 界面独立编号按仓库规则递进：本轮只改新版，NV1.5 -> NV1.6；旧版 OV1.8 不动。
   界面编号不替代项目构建版本，也不改变项目版本 4.1.0。 */
test('新版界面编号递进到 NV1.6，旧版不动', () => {
  const versions = read('../src/lib/ui-versions.ts');
  assert.ok(versions.includes("new: 'NV1.6'"), '新版界面编号随本轮改动递进到 NV1.6');
  assert.ok(versions.includes("old: 'OV1.8'"), '旧版界面编号不动，仍为 OV1.8');
  assert.ok(!versions.includes('NV1.3'), '旧的新版编号 NV1.3 不应残留');
});
