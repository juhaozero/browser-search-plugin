**1. 问题分析**

已审查 manifest、全部 src 模块、注入 CSS、弹窗 HTML/CSS、构建脚本和现有测试。扩展将 Google `.g/.tF2Cxc`、Bing `li.b_algo` 搬到独立的 `#bsp-results`，并通过 content-boot 中的壳布局统一宽度；原始模式通过占位注释还原节点。

修复前的 `src/content-boot.mjs:64` 只允许 `b_mcw` 包裹顶部通栏模块：

```diff
-const WRAPPING_SHELL_IDS = new Set(["b_mcw"]);
+const WRAPPING_SHELL_IDS = new Set(["rcnt", "b_mcw", "b_content"]);
```

与原文件 343 行的 needsWrap 条件、360 行的 nowrap 以及 365 行 `flex:1 1 0` 一起，导致 Google `#rcnt` 中的顶部 AI、结果列与右栏挤在同一行。两列卡片本身已有 `minmax(0,1fr)`，因此继续均分被挤小的主列，并非 Grid 算错。

在 1920px 合成 DOM 的真实 Chromium 渲染中，修复前无 AI 时结果区 1320px、卡片 648px；加入顶部 AI 后分别变为 592px 和 284px。修复后，有无 AI 的结果区和卡片宽度保持一致。复现和最终验证均使用本机浏览器；最终 64 组矩阵在 Chrome 运行。

另外，原 248–254 行缓存仅判断壳宽和模式，AI 晚到而宽度不变时只刷新顶栏；原观察器只盯 `#rso` 时，也看不到 `#rcnt` 下新插入的 AI 兄弟节点。AI 引入的内层 Grid/固定宽度则可能继续约束 `#search/#rso`。

没有发现卡片布局依赖 `:first-child/:nth-child`，也没有 ResizeObserver。getBoundingClientRect 用于右栏测量和导航对齐；上述可复现压缩来自外层 Flex 分配。原代码使用 `root.firstChild` 插入结果盒，会把结果放到 AI 前面，已一并修正。

**2. 代码修改**

- content-boot：所有已支持的外壳均可让顶部模块独占一行；主列使用预算宽度作为 flex-basis，避免 gap 为 0 时出现零宽列；结构变化使缓存失效；观察范围扩展到实际结果壳，仍不长期观察整个 body。
- search-session：在第一条自然结果的位置建立结果盒，保留顶部 AI 顺序；排除带已知 AI 标记的引用卡；用 `data-bsp-results-path` 标记 Google 结果盒祖先，在恢复模式时移除。
- content.css：只释放标记路径上的宽、高、Grid/Flex 约束；卡片禁止 flex-shrink；767px 以下双列降为单列；窄屏 Google 侧栏另起一行；Bing 宽度兜底仅用于居中/双列模式。
- content：修正未定义的 `voidMicrotask` 为 `queueMicrotask`；浏览器测试通过实际 content 入口及 History API 导航覆盖此路径。

关键 Flex 修改：

```diff
-column.style.setProperty("flex", "1 1 0", "important");
+column.style.setProperty("flex", metrics.stackAside ? "0 0 100%" : `1 1 ${metrics.mainWidth}px`, "important");
```

响应式 CSS：

```css
@media (max-width: 767px) {
  #bsp-results[data-mode="double"] {
    --bsp-grid-columns: minmax(0, 1fr);
  }
}
```

**3. 自动化测试**

```powershell
npm ci
npm test
npm run test:browser
npm run build
```

浏览器测试依赖本机 Chrome/Chromium；puppeteer-core 不下载浏览器。可指定可执行文件：

```powershell
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:browser
```

若测试环境本身无法使用浏览器 sandbox，可为本地合成页面测试设置 `$env:BROWSER_NO_SANDBOX = '1'`。该标志只用于测试启动器，不影响扩展。

- 单元测试：70 项通过，包含 3 项新回归测试。
- `test/browser-layout.mjs`：64 组矩阵，Google/Bing × 单列居中/双列 × 1920×1080、2560×1440、390×844、320×844 × 3/10 条 × 有/无 AI。
- 额外测试：AI 位于内层原生 Grid、AI 异步插入、批量插入 20 条结果、从下一页接入并排除重复和 AI 引用、实际 resize、原始模式切换、Bing 原生宽度恢复、实际 content 入口及 History 导航。
- 样式隔离：检查导航未变成卡片、Google 右栏仍可见、AI 内部 Flex 样式未改写。
- 性能检查：批量新增后 Observer 回调停止增长；销毁后活动 MutationObserver 为 0。保留原有 120ms 合并与 runMuted/takeRecords，避免自身搬移反馈循环。
- 控制台检查：可复制 `scripts/check-layout-console.js` 到搜索结果页 DevTools，打印卡片宽高和列宽匹配情况；它只读取页面。
- `npm run build` 成功，可在 Chrome 扩展管理页重新加载 `extension` 或 `dist`。

**4. 其他发现与后续建议**

已处理：窄屏强制两列和主列最小宽度造成的挤压、AI 引用误搬移、顶部模块顺序、零宽 Flex 列、原始模式下 Bing 宽度兜底污染、History 导航异常。

后续建议：

- 给真实 Google/Bing 的不同实验版本保存脱敏 DOM fixture。当前测试使用合成结构，AI 标记过滤也只覆盖列出的已知标记；未知结构仍需补样本。
- `clearCenteredLayout` 现有实现会移除其管理的 inline 属性，未逐项保存页面原先的 inline 值；如需严格恢复引擎初始样式，应增加属性快照及还原测试。本次验证了节点顺序和原生 CSS 宽度恢复，未声称覆盖所有 inline 样式恢复情形。
- Observer 当前观察 childList；若引擎仅通过 class/style 切换顶部模块显隐，可能要等下一次结构变动或 resize 才重新布局。后续可针对壳直接子项加有限属性监听，并过滤自身样式写入。
- 移动端模拟验证的是桌面 DOM 在窄视口的卡片布局；项目的引擎识别仍以桌面网页搜索为目标。

本次没有更改 manifest 权限或引入扩展运行时依赖；puppeteer-core 仅为开发测试依赖。

**后续修复：Google 顶栏“自定义”挤进搜索框**

此前顶栏测试只有简单输入框，缺少 Logo 和右侧操作簇，未覆盖真实页面的定位约束。`collectHeaderBands` 会给整个 `#searchform/#sfcnt/#sf` 定宽及相对定位，`neutralizePageLeftBias` 也会清理它们的偏移。这会改变原生绝对定位按钮的包含块；嵌套容器还可能在缓存刷新时再次被定宽。

现在 Google 搜索顶栏不再参与扩展的定宽、位移与 CSS 覆盖。Logo、搜索表单、语音/图片操作、自定义、应用、账号保留原生位置；结果卡片和导航仍按所选列模式排版。

新增 `test/fixtures/google-header.mjs` 与 `test/browser-google-header.mjs`，测试先读取无扩展时的完整顶栏几何，再逐项比较启用布局、切换模式、按钮替换、窗口缩放、销毁后的几何与 inline 样式；并断言“自定义”和账号按钮不与搜索框重叠。旧实现首个场景即失败，修复后通过。

顶栏覆盖 1859、1920、2560、1366、1024、390px，有/无 AI，双列→单列居中→单列→原始→双列，共 60 组模式用例，另外检查缩放至 800px 与右侧控件替换。新增完整嵌套顶栏单元测试，修正旧测试中“应重写整个 Google 搜索顶栏”的错误预期。

重新加载扩展后，需要刷新已打开的 Google 结果页，以清除旧内容脚本已写入的 inline 样式。当前验证使用完整顶栏合成 fixture 和真实 Chrome 渲染，未读取用户截图对应页面的实时 DOM。

**最终顶栏行为：搜索框居中，并保留右侧控件位置**

上一版完全保留原生搜索框位置，解决了按钮重叠，却撤掉了搜索框居中。最终实现不再以“整个顶栏不变”作为居中模式的通过条件：

- 单列居中/双列：测量 `#bsp-results` 的实际边界，将可见搜索框的中线对齐结果区域中线。优先调整输入框所在的 `.A8SBwf`，旧结构才回退到搜索 form。
- `#searchform/#sfcnt/#sf` 的定位和宽度不改写；Logo、`#gb`、自定义、应用和账号控件独立保留原位。
- 搜索框宽度按左右原生控件的可用空间对称收窄，避免在窄屏中遮挡按钮。仅调整字段宽度和左右 margin，不修改定位包含块和 transform。
- 普通单列/原始模式及销毁：恢复搜索框原有 inline 属性及 `!important` 优先级。动态替换搜索框和窗口 resize 都重新对齐。
- 长期 Observer 仍只挂载有限的结果/顶栏容器，祖先已经覆盖的嵌套观察根会跳过。

浏览器断言同时要求：搜索框与结果中线误差小于 1px、Logo/账号/自定义位置不变、搜索框不与这些控件重叠、原始模式恢复原有位置与样式。覆盖 1859/1920/2546/1366/1024/390px，有无 AI、有无右栏、form 与嵌套字段两种结构和模式往返，共 240 组模式用例，另测缩放与原生表单动态替换。

现场只读诊断脚本 `scripts/check-layout-console.js` 现在也会输出搜索框与结果中线的像素差。
