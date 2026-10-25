# 4.x版本范围维护验收

日期：2026-10-25（上海）；批次`ui-version-range-20261025`，项目4.0.1。

- 用户在本聊天明确授权沿4.x主线继续，5.0.0及以上仍需授权；基于main6c1d496保留PR134的4.0.0装备陈列，没有回退主线或更改展示行为。
- 只修改版本计算/一致性校验及对应测试、当前规则文档和自动版本记录。无LLM、Memory、Planner、Tool Use或记忆归属变化，无新依赖或执行循环；不改路由、新旧界面、主题、业务接口、知识库、工作流或服务器配置。
- `node --import tsx --test tests/version-update.test.mjs tests/maintenance.test.ts`：17/17通过。覆盖4.x补丁/功能、整数分段比较及溢出、5.0.0写入前拒绝、预演不写入、同批去重、旧批次/类型保护；失败前后五份版本文件完全一致。
- 版本脚本maintenance先dry-run再执行：4.0.0→4.0.1，同步package/锁文件/README/日志/批次；知识库版次不变。
- `npm run verify`完整通过：665项、649通过、16平台跳过、0失败；版本、知识哈希、前后端类型、Lint和完整构建通过。既有button.tsx Fast Refresh警告和大包提示保留。外置日志`work/pr-version-range-verify.log`。
- Node24.22.1，实际生产构建由本地Express在localhost:3144提供（禁用外部AI），浏览器未替换源代码。1440×1000英文深色、375×900中文浅色版本历史页面均显示当前4.0.1，保留4.0.0及旧版本记录。新版/旧版切换与主题/语言控件保留，没有重构页面。
- 手机scrollWidth360≤375，原生详情summary高度44px；语义标题、当前构建文字与原生details仍在。没有新增交互或动效，未声称重新进行物理触屏或系统减少动态实测。浏览器error日志为空。
- 截图`desktop-dark-version.png`、`mobile-light-version.png`均为实际页面。构建SHA显示尚未提交基线6c1d496，不能当成发布SHA；测试页及本地服务已关闭、viewport已恢复。
- 本地验证、GitHub保存、合并和现有开发网页发布分开验收；当前尚未发布本批。PR当前head三CI通过后正常dev-only合并，公开version/SHA与网页核对另记于PR，不操作腾讯或更改托管。
