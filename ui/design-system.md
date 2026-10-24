# 耕知·耘诊界面设计

## 定位与参考
面向农业科研与农机维修场景的专业产品官网。保留南京农业大学背景、耕知·耘诊名称、正式首页标题，以及首页和对话页路由。

参考 Leonxlnx/taste-skill 的 design-taste-frontend 与 redesign-existing-projects：
- https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md
- https://github.com/Leonxlnx/taste-skill/blob/main/skills/redesign-skill/SKILL.md

采用有节制的改版：布局变化 5/10，动效 3/10，信息密度 4/10。沿用 React、Tailwind、Lucide 与现有 Motion 组件，不引入另一套 UI 框架。

## 原页面审视
- 首屏在中等宽度下上下堆叠，模型和主文案失去关联。
- 各章节重复等宽卡片与装饰分隔，阅读节奏单一。
- 大标题中文负字距偏紧，品牌字标与正文的字体系统不一致。
- 首页硬编码浅色背景使深色主题出现明显断层。
- 页脚占位链接跳回页面顶部，容易误导用户。

## 视觉规则
- 森林绿作为品牌色；背景、表面、文字和边线都由主题变量控制。
- 中文使用系统中文无衬线字体，避免远程字体加载；标题 500–650 字重，正文保持较舒展行距。
- 首屏采用文字与可交互模型并列布局，移动端显式切换单列。
- 大容器 24–28px 圆角，内容卡片 18px，主要按钮胶囊形。
- 现场问题使用开放列表，架构使用顺序层级，应用场景使用配图与列表，避免整页重复相同卡片。
- 玻璃只用于浮动导航和聊天操作区。Web 效果是对 Liquid Glass 的近似表现，并非 Apple 原生材质。
- 聚焦、按压反馈保持可见；滚动与显现动效服从减少动态效果设置。

## 视觉素材
首屏继续使用已有可交互拖拉机模型。应用场景配图 ui/public/images/agri-fields.webp 为 AI 生成的农业场景示意，页面有明确说明，不代表实地拍摄或校方场地。文件已压缩且延迟加载。
