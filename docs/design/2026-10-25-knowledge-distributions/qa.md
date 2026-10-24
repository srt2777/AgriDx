# 知识角色与风险分布验收

日期：2026-10-25（上海）；版本：3.17.0；分支：`codex/ui-knowledge-distributions-20261025`。

## 问题、解决与效果

现有知识统计只显示条数，无法看出已核对角色和风险标注的缺口。在统计卡下面增量增加两个图表，沿用主题变量与五个入口，不调整导航和路由。原生 SVG 渲染器单独懒加载，构建产物约 6.03 kB、gzip 2.54 kB，无新增依赖。

角色来自原有 `roleCoverage`，风险来自新增可选 `riskCoverage`，只统计有来源依据的风险元数据。前端只加总品牌根节点，型号和组件可重叠，不能再加总。全库归档总览不随筛选变化，界面有固定范围说明。

当前快照：2,014 条已标注角色、2,329 条诊断归档待核实；现象 2,003、原因 2,012、检查 1,006、处理 2,004，复检为零。没有已核对风险标签，4,343 条诊断归档待核实；通识与资料信息不计入风险分布。复检和三个风险类别均显示中性“待补资料”，空条不着色、不推断低风险。

## 本地验证

- Node 24.22.1；npm 10.9.4；Python 3.12.14。当前 Windows 使用等效 npm CLI 入口执行 `npm run verify`。
- 定向命令：`node --import tsx --test tests/catalog-distributions.test.ts tests/catalog-cache.test.ts tests/knowledge-roles-api-20261022.test.ts`，18/18 通过。
- `npm run verify`：555 项，539 通过、16 项 Linux 专用测试在 Windows 跳过、0 失败；版本、知识库哈希、类型、Lint、前后端构建全部通过。既有 Fast Refresh 警告及大 chunk 提示仍存在。
- 新测试覆盖品牌去重、重叠层级、旧接口兼容、损坏汇总拒绝、来源风险依据/信息类/通识排除、角色 URL、图表 loading/error/empty 与文字替代、中英文及真实快照无复检/风险标注。
- 浏览器在 1440×1000、375×812 检查尺寸；375×1200 保存完整分布区概览。新旧版与中英文都无横向溢出，新增链接高度均为 44px。长英文可换行，风险与角色不只用颜色表达。
- 新增图表全部元素的计算样式为 `animation-name: none`、`transition-duration: 0s`；减少动态偏好下也不引入图表动画。
- 键盘搜索“启动”后进入复检角色，URL 保留 q、设置 collection=archive 与 role=retest，显示 0 条与文字空状态；清除角色后恢复 367 条归档搜索结果。
- 直接打开 `/#/knowledge?collection=archive&role=check`，返回 1,006 条；独立标签控制台无错误。来回切换版本会经过首页三维舞台，观察到 React 同步卸载诊断；本批未扩展修改全局版本切换或三维卸载逻辑。

## 截图

| 界面 | 桌面深色 | 375px 手机浅色 |
| --- | --- | --- |
| 新版中文 | [桌面](desktop-new-dark-zh.jpg) | [手机](mobile-new-light-zh.jpg) |
| 新版英文 | [桌面](desktop-new-dark-en.jpg) | [手机](mobile-new-light-en.jpg) |
| 旧版中文 | [桌面](desktop-classic-dark-zh.jpg) | [手机](mobile-classic-light-zh.jpg) |
| 旧版英文 | [桌面](desktop-classic-dark-en.jpg) | [手机](mobile-classic-light-en.jpg) |

## GitHub 与部署

GitHub 保存与当前 head 的 Ubuntu、Windows 和汇总 CI 结果在 PR 中另记。本地通过不代表远端 CI 或部署成功。未部署；全部检查通过后才合入，合并提交使用跳过标记阻止 main 自动发布，不修改工作流。
