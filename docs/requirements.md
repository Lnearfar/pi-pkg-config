# pi-pkg-manager 需求文档

状态：**v1 已实现**。每条都标了 [已决] / [事实]。
本文档记录**结论**；术语见 [../CONTEXT.md](../CONTEXT.md)。

## 1. 目标

在 pi 里用一个 extension 提供 TUI，重点管理两类资源（extensions / skills）和 pi 包（packages）：

1. 逐资源开关，区分 **全局** 与 **项目** 两个作用域，项目设置覆盖全局设置。
2. 浏览已安装包，并支持确认后移除。
3. 一屏看清"什么开着、什么关着"，默认收在 `~` / `.` 两种作用域下都不含糊。
4. 顶层只有两个 Tab：`Extensions` 与 `Skills`；prompts/themes 暂不进入主界面。

## 2. 非目标

- 不重新实现 pi 的加载器：不做"影子加载"、不自己解析 settings 语义。
- 不联网搜索 package，不下载、安装或更新 package。
- 不 fork pi、不改 pi 源码。

## 3. 已核实的事实（pi 0.85.1，本机实测）

### 3.1 设置模型 [事实]

- 全局 `~/.pi/agent/settings.json`，项目 `.pi/settings.json`。
- `extensions` / `skills` / `prompts` / `themes` 是 pattern 数组：
  - 普通项 = 显式加载该路径；
  - `!pat` = 排除（minimatch，glob 可用；对 skill 还会匹配其所在目录）；
  - `+path` = 强制包含（精确匹配，skill 会匹配其父目录）；
  - `-path` = 强制排除（精确匹配，优先级最高）。
- `packages` 数组：`"source"` 或 `{source, extensions?, skills?, prompts?, themes?, autoload?}`。
  - 包内过滤：`[]` = 该类型全部关闭（sticky）；`["-x/y.ts"]` = 精确关闭单个；`+` = 精确打开。
  - 包内普通正向 pattern 是加载基线；不能在关闭单个资源时删除最后一条正向 pattern，否则 pi 会改为默认加载全部同类资源。
  - 精确 `+`/`-` pattern 比较遵循 pi 的规范化：忽略一个开头的 `./` 或 `.\\`，并将路径分隔符统一为 `/`。
  - 同名包同时出现在 global 与 project：project 优先；project 条目带 `autoload:false` 时作为**增量**叠加在 global 之上。
- 项目作用域不可用时（项目未信任）只能写全局。

### 3.2 项目覆盖全局：四类资源 + 包都可行 [事实 + 实测]

pi 自己的 `pi config` 项目模式用的写法（实测通过，两个方向都行）：

- 包：`.pi/settings.json` → `{source, autoload:false, extensions:["-index.ts"]}`（关）/ `["+index.ts"]`（开）。
- 本地资源（含全局安装目录下的资源、`~/.agents/skills`）：在 `.pi/settings.json` 对应数组里写**两条**：
  1. 该资源的**绝对路径**（普通项，让 pi 把它算作项目资源）；
  2. `-<绝对路径>` 或 `+<绝对路径>`（精确模式可匹配绝对路径）。

  只写 `-abs` 不写普通路径项**无效**（实测）。项目条目先于全局自动发现加入，同路径去重后项目状态生效，因此两个方向都能覆盖。

代价：`.pi/settings.json` 里会出现机器绝对路径，不可跨机器复用；资源移动/改名后条目失效。

### 3.3 项目覆盖是"三态"，不是"两态" [已决]

Project 作用域下一个资源有 inherit / load / unload 三种状态（与 `pi config` 一致）。UI 用 `[x]/[ ]`（dim，继承）+ `[+]`（项目加载）+ `[-]`（项目卸载）表达。

### 3.4 生效时机 [事实]

extensions 的加载/卸载需要 `ctx.reload()`（`/reload`）或重启；skills/prompts/themes 也在 reload 时重建 system prompt。因此：改完设置必须提示/触发 reload。

### 3.5 可复用的公开 API [事实 + 实测]

- 数据层：`SettingsManager`（读写 global/project，含 `setProjectSkillPaths` 等）与 `DefaultPackageManager.resolve()`（拿到全部资源 + enabled + 来源 + scope）都是 pi 包公开导出，已在本机跑通。
- 资源发现必须以 pi 的解析结果为唯一来源；不另写一套 skills/extensions 扫描器，不自行改变 pi 的 trust、deduplication、baseDir、manifest、recursive discovery 语义。
- UI 层：只能用 `@earendil-works/pi-tui` 与 pi 导出的组件（`SelectList`、`SettingsList`、`Container`、`Text`、`DynamicBorder`、`getSelectListTheme`、`getSettingsListTheme`、fuzzy 工具）。`pi config` 自己的树形组件 `ConfigSelectorComponent` **不在** 包的 `exports` 白名单里（只能 `import "."` 等），要复刻其交互需自行实现。

### 3.6 `.agents/skills` 与递归 skills [事实 + 实测]

pi 本身能识别 `~/.agents/skills`、项目 `.agents/skills`（向上到 git root）以及任意深度的 `*/SKILL.md`（实测：`skills/writing/tie-ae`、`skills/external/uv` 都能解析）。`pi-skill-toggle` 看不到它们是该扩展自己的扫描目录写死所致，不是 pi 的缺陷。

**已知坑**：`~/.pi/agent/skills/x` 与 `~/.agents/skills/x` 相对各自 baseDir 的相对路径都是 `skills/x`，一个 `-skills/x` 会同时命中两者。UI 必须按「来源 + baseDir」建模，写盘时优先用绝对路径（与 `pi config` 一致）。

## 4. 已决需求

### R1 作用域与覆盖模型 [已决]

- 只有两个作用域：Global / Project。
- **Global 视图**显示全局资源；切换资源写入全局 settings。
- **Project 视图**显示当前 cwd 的项目资源在前、全局资源在后：
  - 项目本地资源的开关只由 Project settings 控制，不受 Global 开关影响；
  - 全局资源默认 inherit，Project 中切换时创建项目级覆盖；
  - Project 覆盖 Global，双向（global 开→项目关；global 关→项目开）。
- 项目覆盖为三态：inherit / load / unload（见 3.3）。
- Project 视图中 `Space` 切换项目实际状态；对全局继承资源，`r` 删除项目覆盖并恢复 `inherit`，不使用循环三态操作。
- 项目自有资源没有 Global 可继承，只做独立 on/off；同一次编辑中切回原始状态会自动取消该未保存修改。
- 包移除不记录历史；"disabled" 与"removed"不进入同一个状态模型。

### R2 界面结构 [已决]

采用方案 A（与 pi 内置 `pi config` 同一心智模型，第三方管理器 pi-skills-manager 亦复刻此风格）。界面只展示 pi 已检测到的 resources，不自行补充或过滤：

- 顶层只有 `Extensions` / `Skills` 两个 Tab；每个 Tab 只展示对应资源。
- 顶层资源选择器顺序为 `Skills`、`Extensions`；作用域选择器独立存在，顺序为 `Project`、`Global`。
- 两个选择器互相独立，不组合成四个 Tab；默认打开 `Skills + Project`。
- 管理器保持居中的小型 overlay：默认宽度 80、最小宽度 50、最大高度为终端的 80%、外边距 1；外层面板与选中资源行使用当前主题的 `borderAccent`，静态来源标题使用 `borderMuted`，容器内部保持终端默认背景。
- 所有 UI 文案、状态和提示使用纯英文。
- 列表行显示名称、状态、对齐的 Project / Global 状态列与简短来源；当前项使用紧凑单行 `selectedBg`、accent 左右边缘和 `›` 指针；`Enter` 打开资源详情卡，展示完整路径、package、覆盖关系和诊断；详情页 `Enter` 与 `Esc` 返回列表。
- 标题栏使用 `Package Manager   [Skills] Tab Extensions   [Project] ←→ Global` 的文本结构；当前选择使用 accent，`Tab` 与 `←→` 使用 dim 小按键标签；`Tab` 切换 Skills/Extensions，`←/→` 切换 Project/Global。
- `Project` 视图显示对齐的 `Project` 与 `Global` 状态列；标题栏高亮 Project，`Space` 修改 Project 状态。`Global` 视图只显示 Global 相关信息，标题栏高亮 Global，`Space` 修改 Global 状态；Global 状态列保持与 Project 视图相同的最右侧列位。内部宽度低于 64 列时，标题栏与状态列表使用 `P` / `G` 缩写。
- 底部使用两层信息栏：状态行左侧显示当前位置 `6/24`，右侧显示编辑状态；工具栏使用按键标签展示资源操作，`Tab` 与 `←→` 仅在标题栏展示；Project 工具栏包含 `[r] Inherit`，Global 工具栏省略该操作；窄终端将工具栏自动换成两行并保留全部操作。
- 切换视图时保留每个视图的搜索词、滚动位置与 pending 修改。
- `Global` 视图编辑并展示全局资源与 Global 状态。
- `Project` 视图编辑当前项目设置，同时显示 Project 与 Global 状态列；项目资源排在前，全局资源默认 inherited，直接编辑时写入项目覆盖。
- 列表按来源分组（每个包一组、每个本地目录一组），来源是辅助信息；不再额外增加 Package 顶层视图。
- 每个本地目录与包来源使用同一种固定展开来源分组；标题以静态 `⌄` 开头，左侧显示缩短来源路径、右侧显示统计，具体 resource 行相对标题缩进一层并承载全部操作；Project 视图统计 Project 生效状态，Global 视图统计 Global 状态；长路径使用中间省略号，详情页显示完整路径与完整 package source。
- `/` 进入本地搜索模式，只过滤当前 Tab 中 pi 已检测到的资源，绝不联网；标题栏下方显示 `⌕ Search: <query>` 紧凑输入栏，查询文本使用 accent；列表只展示含匹配资源的来源容器；搜索模式下所有字符仅作为查询文本，`Esc` 清空并退出搜索。
- 普通列表模式下 `r` 只对全局继承资源恢复 inherit；搜索模式中的 `r` 只是查询字符。
- 一个同时提供 extension 和 skill 的包会分别出现在两个 Tab。
- Project 视图只能移除项目包；全局包在 Project 视图中只能设置/清除项目覆盖，必须切换到 Global 才能卸载。
- 卸载属于即时包操作，不进入 toggle 的 pending state；执行前必须确认。
- 移除包后不保留历史；本地资源不执行文件删除。
- 左侧状态符只表示当前 Project 生效状态，使用实心 `●` 或空心 `○`；Project / Global 列只显示文字。列表顶部显示对齐列名 `Project` 与 `Global`。Project 列以 `— (on)` / `— (off)` 表示 inherit 后的生效状态，以 `on` / `off` 表示显式 Project 覆盖；Global 列显示全局状态，`—` 表示资源仅属于 Project。
- Project 视图中，Global 为 `on` 时，Project 生效 `on` 显示 success `●`，Project 生效 `off` 显示 error `●`。Global 为 `off` 时，Project inherit 显示 muted `○`，显式 Project `on` 显示 success `●`，显式 Project `off` 显示 error `●`。Project-only 资源的 `on` / `off` 分别显示 success / error `●`。
- Global 视图中，Global `on` 显示 success `●`，Global `off` 显示 muted `○`。
- 入口命令为 `/pkg-manager`、`/skills-manager`、`/extensions-manager`：`/pkg-manager` 默认打开 Skills + Project；两个定向入口分别打开 Skills + Project 与 Extensions + Project；进入后 `Tab` 仍可切换资源类型。
- `Esc` 按页面层级处理：详情页返回列表；搜索有内容时先清空；主列表无 pending 时关闭；有 pending 时确认是否丢弃后关闭。
- 搜索过滤、关闭、改完提示 reload —— 与 `pi config` / `pi-skills-manager` 的交互保持同源。
- 不做"两层同时可编辑"（双圆点 / 双栏）：无生态先例，且 pi 的数据模型本来就是"一个作用域 = 一个写入目标"。

### R3 默认值与写入策略 [已决]

- 默认值跟随 pi 现状（装了 = enabled），UI 只如实显示，**不偷偷写盘**。
- 首次加载 extension 只读取并解析当前状态，不初始化、不规范化、不修改用户已有 settings。
- Project 作用域默认 **inherit**：不写任何条目 = 完全继承 Global；只有显式改动才产生项目条目（即 `pi config` 项目模式的行为）。
- toggle 只先修改内存中的 pending state；没有变化时不写盘。
- 列表圆点立即预览保存后的状态，已修改资源行末尾追加 warning `*`；详情显示 before → after；状态行右侧显示 `N unsaved changes · [Ctrl+S] Save`。
- 再次操作回到原始状态时自动删除对应 pending，并移除 `unsaved` 标记。
- `Ctrl+S` 保存四个视图中的全部 pending；保存前按 scope/type 汇总变化。
- `Esc` 在存在 pending 时询问是否丢弃全部修改。
- 打开 UI 时记录 Global/Project settings 的基础版本；不监听文件，也不提供手动刷新。
- 只在 `Ctrl+S` 时检查磁盘：未变化则正常保存；已变化则读取并更新发生变化的条目，以最新值为底叠加 pending，展示合并后的 diff/候选版本后再保存。
- UI 打开期间由外部新增/删除的资源，重新打开管理器时才显示。
- 审阅后、实际写入前再次校验文件版本；若又有变化，重新生成候选版本并重新确认。
- 无关的外部修改必须保留；同一资源冲突时，pending 仅在用户确认候选版本后覆盖该目标。
- 写盘只更新实际变化的 settings 条目，不重写用户未涉及的配置。
- 每个 scope 独立写入：候选内容先写入同目录隐藏 temp，校验/flush 后原子替换；原文件在替换前保持不动。
- 保存期间只允许出现本工具前缀的 temp 与写锁；成功或可处理失败后立即清理，不保留 `.bak`、历史或缓存；崩溃遗留的 stale temp 下次启动只按本工具精确前缀清理。
- 某 scope 写入失败时保留其 pending、允许重试；另一 scope 已成功的修改不回滚；存在失败时不提示 reload。
- 保存后询问是否立即 reload；选择否时只提示可稍后执行 `/reload`。
- v1 不提供任何批量 enable/disable；分组标题始终只读。

### R4 包移除 [已决]

- 选中包内任意资源后按 `Delete` 发起移除；确认框显示包名、作用域及将受影响的全部 Skills/Extensions。
- 只移除当前作用域的包；全局包必须在 Global 视图移除。
- `remove` 只表示移除 npm/git 包并从 settings 中删除配置。
- 不删除本地资源文件；本地路径包只移除 settings 条目，与 pi 原生行为一致。
- 若该包存在 pending toggle，丢弃该包在全部视图/作用域中的相关 pending。
- 先持久化移除 settings 条目，再清理 npm/git 托管文件；settings 写入失败时不动文件，文件清理失败时明确提示 orphan cleanup warning。
- 不记录移除历史或墓碑；移除后重新解析资源并从当前列表消失。
- 移除成功后询问 `Reload now?`；拒绝时提示稍后使用 `/reload`，不回滚移除。

### R5 诊断展示 [已决]

- pi 能检测到但有问题的资源仍显示在原分组位置；不静默隐藏。
- 左侧 `●` / `○` 始终表达当前 Project 生效状态；资源名后追加诊断标记。
- `◇ shadowed`：资源名后显示 warning `◇`，资源被更高优先级的同名 skill 覆盖；详情显示覆盖它的路径，仍允许 toggle。
- `⚠ error`：资源名后显示 error `⚠`，资源有可安全取得的诊断错误；详情显示原因。

### R6 项目 Trust [已决]

- Project 未被 trust 时，Project 视图只读，标题栏下方显示 `⚠ Project settings require Pi trust` warning；Project 状态列显示 `trust required`，Global 状态列保持可读可编辑。
- 不自动 trust，不写 `.pi/settings.json`；显示 pi 原生的 trust 提示。
- 完成 trust 后才允许保存 Project 覆盖。

### R7 自身保护 [已决]

- `pi-pkg-manager` 自身仍显示为 `🔒 [in use]`，`[in use]` 使用 warning 标签，Project / Global 状态列按普通全局资源展示。
- UI 内不可 disable/remove；卸载必须使用外部 `pi remove`。

## 5. 实现约束

- settings 的解析与写入语义复用 pi API；不自行发明 JSONC 处理规则。
- Pi 0.85.1 不公开当前 extension runtime diagnostics；为避免重复执行 extension，v1 对 extensions 只安全报告 missing-path，不能声称验证了运行时 active/error。Skills 使用公开 `loadSkills()` 提供 collision/validation diagnostics。
- 实现中的非产品级细节不得改变以上已确认交互。

## 6. 参考实现（前作）

| 项目 | 做的事 | 缺口 |
|---|---|---|
| `pi config`（pi 内置） | 四类资源开关，global/project 双模式，树 + 搜索，三态覆盖 | 不管包安装/搜索/删除；无墓碑；不含包目录浏览 |
| `pi-plugin-manager` | 包级 Tab（Installed/Search）、install/remove/update/详情、npm 目录搜索 | 无资源级开关、无项目级覆盖 |
| `pi-config-manager` | preset/tools/skills/extensions | 曾把全局资源写成一批 `-` 强制禁用，副作用大 |
| `pi-skill-toggle` | skill-only，enabled/hidden/disabled 三态，filter + 批量保存 | 扫描目录写死（缺项目 `.agents/skills`）；相对路径模式在不同 baseDir 间串味 |
