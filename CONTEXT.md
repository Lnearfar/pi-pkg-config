# CONTEXT

pi-pkg-config 的领域词汇表。只放术语与含义，不放实现细节、不放需求。

## Resource（资源）

pi 可以加载的最小可开关单位，一个资源对应 pi 资源解析结果中的一条路径。

- 一个 extension 入口文件（`.ts`）
- 一个 skill（其 `SKILL.md`）
- 一个 prompt template（`.md`）
- 一个 theme（`.json`）

## Resource type（资源类型）

`extensions` | `skills` | `prompts` | `themes`。四种类型在 pi 的 settings 里是四个平等的 pattern 数组。

## Package（包）

在 `packages` 里声明的一个来源：`npm:...` / `git:...` / 本地路径。一个包可以提供 0..n 个资源，也可以自带 skills/extensions 目录或 `pi` manifest。包可以被安装、移除、升级。

## Local directory（本地目录）

pi 自动扫描的资源目录，不是包、不能被"安装/移除"：`~/.pi/agent/{extensions,skills,prompts,themes}`、`~/.agents/skills`、`<project>/.pi/{...}`、`<project>/.agents/skills`（cwd 向上到 git root）。本地目录只提供资源。

## Source（来源）

一个资源是从哪来的：某个包，或某个本地目录。UI 里用作分组依据。

## Scope（作用域）

设置写在哪里、对谁生效：**Global**（`~/.pi/agent/settings.json`，所有项目）或 **Project**（`.pi/settings.json`，当前项目）。

Scope 指的是**设置条目**所在的作用域。一个全局安装的包，其资源可以由 Project 作用域的条目覆盖。

## Resource origin（资源归属）

资源所属的解析范围：**Global** 或 **Project**。Resource origin 与 Scope 表示不同的领域概念；_Avoid_: Scope。

## Toggle state（开关状态）

单个资源在某个作用域内的状态：**enabled**（加载）或 **disabled**（不加载）。

## Override state（项目覆盖状态）

在 Project 作用域看一个资源时的三种状态：

- **inherit**：项目里没有针对它的条目，生效状态来自 Global。
- **load**：项目显式加载它（即使 Global 是 disabled）。
- **unload**：项目显式不加载它（即使 Global 是 enabled）。

三态与 `pi config` 的项目模式一致（`[x]/[ ]` 表示 inherit、`[+]` 表示 load、`[-]` 表示 unload）。

## Inherited（继承）

Project 作用域下，资源处于 **inherit**，其生效状态完全由 Global 决定。UI 在 Project 状态列以 `— (on)` / `— (off)` 显示继承后的生效状态。

## Effective state（生效状态）

当前会话 pi 实际会不会加载这个资源。由 Global 与 Project 两条设置共同决定，可能与用户直觉不一致（例如"全局关了但本项目开了"）。

## 待定术语

- **Hidden（对模型隐藏）**：资源仍可被 `/skill:name` 调用，但不出现在 system prompt 中。本工具不纳入此状态。
