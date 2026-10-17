# Willemstad-X 架构说明

本文档描述 fork 后的仓库结构、构建数据流与开发约定。目标读者是第一次接手本仓库、准备改动主题样式的人。

- 上游原版：[tingmelvin/willemstad-x](https://github.com/tingmelvin/willemstad-x)（原作者已停止维护）
- 许可证：GNU GPL 3.0（`LICENSE`），第三方片段保留各自原始许可
- 运行时依赖：Node.js >= 20，无构建框架（只用 `node:` 内置模块）

---

## 1. 一句话架构

> `src/` 是唯一源码，`scripts/build.mjs` 把 `src/` 拼成根目录的 `theme.css`；构建是纯文本装配，`--check` 对磁盘产物做**字节级**比对，因此任何漂移都是真实、有意的改动。

```text
                    ┌──────────────────────────────────────────┐
                    │  src/entries/theme.css  （构建入口）       │
                    │  按顺序 @include 全部分片                  │
                    └───────────────────┬──────────────────────┘
                                        │  scripts/build.mjs
        ┌───────────────────────────────┼───────────────────────────────┐
        │                               │                               │
   @include 分片               @font / @svg 资源指令            @raw 内联 YAML
   （src/**/*.css）        （src/assets/** 的 woff2 / svg）   （src/style-settings/*.yaml）
        │                               │                               │
        └───────────────────────────────┼───────────────────────────────┘
                                        ▼
                     ┌──────────────────────────────────────┐
                     │  theme.css      （Obsidian 主题产物）  │
                     │  publish.css    （Publish 冻结轨道）    │
                     └──────────────────────────────────────┘
                                        │
                                        ▼
                              tests/  （node:test 校验）
```

---

## 2. 目录结构

```text
src/                      # 唯一源码目录（拆自 theme.css 单文件）
  entries/theme.css       # 构建入口，按顺序 @include 所有分片
  meta/                   # AA* 许可证/版权/打印样式/Hub 兼容（AA01/AA02 开头、AA03 收尾）
  root/                   # AB* AC* 根变量、排版、圆角、动画、阴影
  interactives/           # AI* 按钮/复选框/输入框等交互控件
  elements/               # AJ* AT* 零散元素、标题栏
  colour/                 # CA* CB* CC* CD* CR* CX* 配色系统
  app-ui/                 # DA* DB* DC* DS* DV* 应用外壳（标签页/侧栏/状态栏/启动屏）
  editor/                 # EA*-EY* EL* ES* ET* EV* 编辑器与阅读视图
  modals/                 # MA* MB* MC* MD* 各类模态框
  plugins/core/           # PB* Obsidian 核心插件
  plugins/community/      # PC* 社区插件适配
  cssclass/               # EX* CSSClass 特性（LaTeX/Cornell/杂志排版等）
  style-settings/         # 12 个 Style Settings 面板定义（YAML，被 src 内联引用）
  assets/fonts/           # 17 个 woff2 字体（base64 内嵌源）
  assets/icons/           # SVG 图标（data URI 源；编译产物中 52 处引用，内容去重后 27 个文件）
src-publish/              # Publish 专用冻结轨道（v0.5.4，暂未迁移）
scripts/build.mjs         # 构建：src/ → theme.css + publish.css
scripts/extract.mjs       # 一次性迁移脚本：theme.css → src/（保留可重跑）
scripts/check-version.mjs # 校验 manifest.json / versions.json / theme.css 三处版本号一致
scripts/bump-version.mjs  # 发版：改写版本号源、重建 theme.css、复跑校验
tests/                    # 自动化测试（node:test）
docs/                     # 架构文档（本文件）+ KNOWN-ISSUES.md
.github/workflows/        # CI：audit / 构建一致性 / extract 往返 / 版本一致性
archive/                  # 已 gitignore 的历史产物
CONTRIBUTING.md           # 贡献流程（日常命令、常见任务）
```

当前实际规模：**194 个文件** = 138 个 CSS（137 个分片 + 1 个入口）+ 17 个 woff2 + 27 个 svg + 12 个 yaml。

### 2.1 从 `theme.css` 里拆出来的两类特殊目录

`extract.mjs` 在切分 `theme.css` 时，除了按语义分模块，还额外产生两个目录——它们是**构建期实现细节**，不属于语义分层：

| 目录 | 内容 | 说明 |
| --- | --- | --- |
| `src/font-faces/` | 6 个 `AF*` 分片 | `@font-face` 声明本体；字体二进制在 `assets/fonts/`，由 `/*@font …*/` 指令引用。**注意目录名是 `font-faces` 不是 `fonts`**，避免与 `assets/fonts/` 混淆 |
| `src/overrides/` | 2 个 `X1*` 分片 | 原主题末尾的 "Small Fixes" 覆盖段，级联位置靠后，故单独成目录 |

---

## 3. 构建数据流

### 3.1 入口文件与级联顺序

`src/entries/theme.css` 是一份**清单**，不是样式。它由三部分组成：

1. 原 `theme.css` 的文件头（`@charset`、版权横幅等），逐字节保留；
2. 一段 `/*@manifest … */` 说明注释，构建时被丢弃；
3. 若干 `/*@include <相对 src/ 的路径> */`，**顺序即 CSS 级联顺序**。

当前顺序（与拆分前的 `theme.css` 行序完全一致）：

```text
meta → root → interactives → elements → colour → app-ui → editor
→ modals → plugins/core → plugins/community → overrides
→ style-settings → cssclass → font-faces → meta（AA03 收尾）
```

> `meta` 出现两次不是笔误：`AA01`（许可证横幅）在文件最前，`AA03`（收尾声明）在最末，中间隔着全部样式。**重排会改变渲染结果**，追加才是安全的。文件名前缀（`000-`、`001-`…）只为目录可读性，真正的顺序以入口文件的 include 顺序为准。

### 3.2 指令语法

指令全部写成**普通 CSS 注释**，因此 `src/` 保持合法 CSS、可通过 lint：

| 指令 | 作用 |
| --- | --- |
| `/*@include <path> */` | 递归内联另一个分片 |
| `/*@font <path> */` | 展开为 `url("data:font/woff2;charset=utf-8;base64,…")` |
| `/*@svg <path> */` | 展开为 `url("data:image/svg+xml;base64,…")` |
| `/*@raw <path> */` | 原样内联一个文件（Style Settings 的 YAML 面板定义） |
| `/*@manifest … */` | 仅出现在入口，构建时整行丢弃 |

路径一律相对 `src/`，且被限制在 `src/` 内（越界会报错）。

### 3.3 构建产物

| 产物 | 来源 | 说明 |
| --- | --- | --- |
| `theme.css` | `src/` 全量装配 | 用户安装的主题入口，**必须提交** |
| `publish.css` | `src-publish/publish.css` | Obsidian Publish 专用，v0.5.4 冻结轨道；`src-publish/` 尚未迁移时构建不覆盖它 |

`theme.css` 的字节由 `tests/build.test.mjs` 的基线断言钉住（当前 SHA-256 `0384718b4397846158efa2db0621cf274f4551f21e24306fca629ab755a6d2a4`，5,257,337 字节）。

> **历史**：基础设施里程碑期间，这条断言钉的是**上游 v1.11.1** 的哈希（`f223ca9d…`），用来证明「拆分没有改变任何一个字节」。该不变量在修复 8 个已知缺陷时**被有意退役**——留着它只会挡住修复。现在它仍然做本职工作：任何产物字节变化都必须被察觉并在此登记。缺陷修复记录见 [KNOWN-ISSUES.md](KNOWN-ISSUES.md)。

构建刻意保持"笨"：**不做压缩、不做 autoprefixer、不生成 source map**。主题的 selector 特异性与声明顺序本身就是产品，任何重排都是静默的行为变更；保持纯文本装配，才能让 `--check` 成为有意义的回归测试。

### 3.4 校验与常用命令

`package.json` 目前提供的全部脚本：

| script | 实际命令 | 用途 |
| --- | --- | --- |
| `build` | `node scripts/build.mjs` | 由 `src/` 生成 `theme.css`（`publish.css` 在 `src-publish/` 存在时才重写） |
| `build:check` | `node scripts/build.mjs --check` | 内存构建后与磁盘比对，有漂移 exit 1 |
| `build:audit` | `node scripts/build.mjs --audit` | 检查孤立分片 / 未被引用的资产 |
| `extract` | `node scripts/extract.mjs` | `theme.css` → `src/`（`src/` 已存在会拒绝，需 `--force`） |
| `check:version` | `node scripts/check-version.mjs` | 三处版本号是否一致 |
| `bump` | `node scripts/bump-version.mjs` | 发版：改写版本号源 + 重建 + 复跑校验 |
| `test` | `node --test "tests/**/*.test.mjs"` | 全部测试（Node 26 不接受目录参数，必须用 glob） |
| `test:build` | `node --test tests/build.test.mjs` | 只跑构建一致性测试 |
| `lint:css` | `stylelint "src/**/*.css"` | CSS 静态检查 |
| `lint:css:fix` | `stylelint "src/**/*.css" --fix` | 自动修复可安全修复的部分 |
| `verify` | `build:audit && build:check && check:version && lint:css && test` | **CI 门禁**，必须全绿 |
| `verify:all` | `verify` | `verify` 的别名 |

> **注意**：`verify` 曾经**不包含** `check:version`，因为 `versions.json` 与 `manifest.json` 的 `minAppVersion` 不一致是上游遗留的真实缺陷（[KNOWN-ISSUES.md](KNOWN-ISSUES.md) #1）。该缺陷已修（以 Obsidian 1.13 为准），检查已收回门禁。

直接用 node 调用（不经 npm，便于调试）：

```bash
node scripts/build.mjs --verbose   # 额外打印每个分片的大小
node scripts/check-version.mjs --json  # 机读结果
```

---

## 4. 迁移脚本 `scripts/extract.mjs`

`theme.css` 曾是 5MB / 5 万行的单文件。`extract.mjs` 是把它切回 `src/` 的**一次性**脚本，但被刻意设计为**可重复运行**，作为拆分的溯源记录：

```bash
node scripts/extract.mjs            # theme.css → src/（src/ 已存在会拒绝，需 --force）
node scripts/extract.mjs --force    # 覆盖重建 src/
```

它的工作原理：

1. 按 `theme.css` 自带的分节框注释（`/* ───…` + `> AB01` 这种两字母命名空间）切段；
2. 用 `RULES` 表把命名空间映射到目录（`AA01→meta`、`AB→root`、`PC→plugins/community`…），**映射不到的段直接报错**，避免静默错位；
3. 把三类内联载荷提升为独立文件，避免 5MB 的 base64 污染 diff：
   - `@font-face` 里的 base64 woff2 → `src/assets/fonts/*.woff2`（原位留 `/*@font …*/`）
   - SVG data URI → `src/assets/icons/*.svg`（原位留 `/*@svg …*/`）
   - `/* @settings … */` YAML 块 → `src/style-settings/*.yaml`（原位留 `/*@raw …*/`）
4. 生成 `src/entries/theme.css` 清单。

**不变量**：先 `extract.mjs` 再 `build.mjs`，必须逐字节复现原始 `theme.css`。这条不变量是整套重构的安全网，CI 的 `extract-roundtrip` job 与 `tests/build.test.mjs` 都依赖它。

> 想自己验证往返是否成立，不要直接 `--force` 覆盖工作区的 `src/`（会踩到别人正在编辑的分片）。用 `--out` 写到临时目录再比对：
>
> ```bash
> node scripts/extract.mjs --out .tmp/rt --force
> # 比对 .tmp/rt 与 src/ 的每个文件哈希（二者应完全一致）
> ```

> **实现注记（非缺陷）**：`--force` 目前是「先删 `src/` 再重建」，中途失败会留下空目录。对一次性迁移脚本这是可接受的；如果将来它要长期留存，应改成「写临时目录 + 原子替换」。当前不改，因为收益低于引入的风险。

---

## 5. 换行与编码（改动前必读）

**只有 `theme.css` / `publish.css` 是 CRLF。其余所有文本文件（src 分片、YAML、脚本、文档、配置）一律 LF。** 这不是疏漏，是两条硬约束推出来的：产物必须字节稳定，源码必须可复现。`.gitattributes` 里分开写：

```gitattributes
# 默认 LF，且不做换行转换
* text=auto eol=lf

# 只有产物是 CRLF
theme.css    text eol=crlf
publish.css  text eol=crlf

# 源码与配置：LF
src/**/*.css  text eol=lf
src/**/*.yaml text eol=lf
*.mjs         text eol=lf
*.json        text eol=lf
*.md          text eol=lf
```

| 文件 | 换行 | 为什么 |
| --- | --- | --- |
| `theme.css` / `publish.css` | **CRLF** | Obsidian 直接加载的产物；`build.mjs --check` 做**字节级**比对，输出固定 CRLF。检出成 LF 会误报漂移 |
| `src/**/*.css` | **LF** | 源码分片，不是产物。`extract.mjs` 固定写 `${lines.join('\n')}\n`（LF）；若 git 把分片规范化成 CRLF，「重新 extract 一遍」的结果与仓库文件**字节不一致**。`build.mjs` 读分片时会归一化，所以换行不影响产物字节——但影响 extract 的可复现性 |
| `src/style-settings/*.yaml` | **LF** | 同分片，但**必须显式声明**：否则 `* text=auto` 会按平台把 YAML 规范化成 CRLF，导致「重新 extract 一遍」的结果与仓库里的文件字节不一致——实测 12 个 YAML 全部对不上（1168 vs 1140 字节），extract 往返测试会红 |
| `scripts/*.mjs` / `*.md` / `*.json` | **LF** | 手写源码与文档，与 Node / Git 生态一致 |

**为什么分片换行不影响产物？** `build.mjs` 的读取路径是 `readFileSync(...).replace(/\r\n/g, '\n')`——任何输入换行都被归一化成 LF；拼接完成后在输出阶段一次性 `replace(/\n/g, OUTPUT_EOL)` 转 CRLF。所以产物换行由 `OUTPUT_EOL` **单点决定**，与分片怎么存无关。

可以用 `git check-attr` 自查属性是否生效：

```bash
git check-attr eol -- theme.css publish.css \
    src/colour/022-ca00.css src/style-settings/01-v1-willemstad-info.yaml
# theme.css: eol: crlf
# publish.css: eol: crlf
# src/colour/022-ca00.css: eol: lf
# src/style-settings/01-v1-willemstad-info.yaml: eol: lf
```

**三条容易搞反的约定：**

- **不要用 `*.css text eol=crlf` 这种全局规则。** 它会把 `src/**/*.css` 分片一起锁成 CRLF，于是「重新 extract 一遍」的产物与仓库里的文件字节不一致，`git status` 会一片红。产物和源码是**两件独立的事**，规则必须分开写。
- **不要因为 `src/` 是 LF 就删掉 `theme.css` / `publish.css` 的 CRLF 规则。** 那两行保护的是产物的检出换行，是 `build:check` 在干净 clone 上可复现的前提。
- **`src/` 分片保持 LF 是约定。** 改成 CRLF 不会让构建失败（build 会归一化），但会破坏 extract 的可复现性，并制造无意义的 diff 噪音。所以「改不改都不影响产物，但请别改」。

> **教训（值得记住的排查方法）**：`*.css text eol=crlf` 这类换行配置的 bug **无法通过「在同一工作区反复验证」发现**——验证对象和验证者共享同一份被绕过 git 规范化的文件，所以永远看不到 checkout 阶段发生的转换。必须真做一次 **干净 clone** 才能暴露。同理，任何涉及换行的验证都应在干净 clone 里做一次。

其他编码约定：

- 全部文件 UTF-8 **无 BOM**；`extract.mjs` 遇到 BOM 直接报错而不是猜测。
- `theme.css` 的换行由 `tests/syntax.test.mjs` 断言（要求 5 万+ CRLF、零裸 LF、零裸 CR）。

---

## 6. 测试

`tests/` 使用 Node 内置 `node:test`，零测试框架依赖（`package.json` 里没有 jest/vitest/mocha）。**10 个测试文件、93 个用例**，另有 2 个支撑文件（`helpers/css.mjs`、`fixtures/obsidian-builtins.json`）。

```text
tests/
  helpers/css.mjs                  # 支撑：路径常量、postcss 解析、变量提取、sha256
  fixtures/obsidian-builtins.json  # 支撑：Obsidian 内置 CSS 变量 allowlist
  README.md                        # 支撑：每类测试防什么、怎么跑、失败怎么查
  build.test.mjs            (7)    # 构建一致性 + 上游基线
  structure.test.mjs        (6)    # src/ 结构完整性
  syntax.test.mjs          (10)    # 产物 CSS 语法 / 编码 / 换行
  style-settings.test.mjs  (14)    # Style Settings 面板与 YAML
  variables.test.mjs        (9)    # CSS 变量引用 vs 定义
  assets.test.mjs          (10)    # 内嵌字体 / SVG 资产
  manifest.test.mjs        (12)    # manifest.json 字段与语义
  version.test.mjs         (11)    # 三处版本号一致性
  budget.test.mjs           (7)    # 体积预算
  stylelint.test.mjs        (7)    # lint error/warning 基线与上限
```

| 文件 | 防的问题 |
| --- | --- |
| `build.test.mjs` | `src/` 与 `theme.css` 漂移；`--check` 必须**确定**（连跑两次结论相同）；`--audit` 无孤立分片；`theme.css` 仍与上游 v1.11.1 基线字节一致；`publish.css` 未被误改；产物体积合理 |
| `structure.test.mjs` | 每个分片能独立解析（不能有跨文件未闭合注释）；注释在文件内配平；每个分片**恰好被 include 一次**（无孤儿、无重复）；入口清单只含指令 / `@charset` / 注释；清单里的路径是 POSIX 相对路径且真实存在 |
| `syntax.test.mjs` | 产物 CSS 解析零错误；花括号配平；注释配平；无 `@import`（Obsidian 不支持）；无 BOM 且以 `@charset` 开头；UTF-8 无替换字符；**CRLF 一致（零裸 LF、零裸 CR、5 万+ 行）**；无残留指令标记；`@charset` 恰好一次且在首位 |
| `style-settings.test.mjs` | 12 个 `@settings` 面板齐全（含两行注释形式）；YAML 可解析；面板 id 唯一非空；面板集合与预期完全一致；setting 的 `type` 合法；setting id 全局唯一；有 id 必有 title；`class-toggle` 的类名确实被 CSS 引用；`variable-*` 的 id 对应到 CSS 读取的自定义属性；`src/style-settings/*.yaml` 与 `theme.css` 内联内容同步 |
| `variables.test.mjs` | 主题里 `var(--x)` 引用的变量确实有定义；未定义的必须在 `fixtures/obsidian-builtins.json` allowlist 内；allowlist 里不能有已失效条目；无空/畸形变量名；无 `var(--x: ...)` 这类定义笔误 |
| `assets.test.mjs` | base64 woff2 解码后是 `wOF2` magic；SVG data URI 解码后以 `<svg` 开头；`@font-face` 数量与 `src/assets/fonts` 文件数一致；无悬空资产引用 |
| `manifest.test.mjs` | `manifest.json` 必填字段与类型；`version` 出现在产物文案里；`versions.json` 含当前 version 键；`minAppVersion` 是合法且合理的版本号 |
| `version.test.mjs` | `manifest.json` / `versions.json` / 产物内版本文案三者一致；`check-version.mjs` 在各类不一致场景下**确实会失败**（反向验证脚本本身有效） |
| `budget.test.mjs` | `theme.css` 总量上限、非 base64 部分体积上限、单规则块行数上限——防止主题膨胀拖慢 Obsidian 启动 |
| `stylelint.test.mjs` | lint 结果基线：**0 error** 是硬断言；每条规则有**精确计数**（`EXPECTED_WARNINGS`），双向断言——多了报新增债务、少了报规则失效；lint 目标必须是 `src/**/*.css`（不含生成物）；已修的 #5/#6 各有一条「必须保持为 0」的断言 |

测试分两层。第一层是**契约**：构建可复现、分片可独立解析、变量引用有登记、面板结构合法。第二层曾是**缺陷 pin**——断言已知缺陷仍然存在且数量稳定，修好那天转红。8 个缺陷修复后，这些 pin 已全部翻面为「断言已修复状态」（例如「12/12 面板通过严格 YAML 解析」「shorthand 覆盖必须为 0」），**不是被删除**：它们现在防的是缺陷复发。

> 跑测试：`pnpm test`（全部）或 `pnpm run test:build`（只跑构建一致性，最快）。当前 `pnpm test` 结果为 **93 通过 / 0 失败 / 0 跳过**。

缺陷的修复记录、未修项与「哪些改动会影响渲染」的清单见 [KNOWN-ISSUES.md](KNOWN-ISSUES.md)。

---

## 7. 归档区 `archive/`

历史产物已移出仓库、只留在本地：

| 路径 | 内容 |
| --- | --- |
| `archive/old/`（68 MB） | 早期 CSS 快照 `v0.0.1a1` – `v0.3.0`（v0.3.x 为 Bryggen 系列），外加 `build/scss/`（57 个 SCSS）、`src-v0.5/`（122 个 SCSS，Jordaan 时期）、`src-v1alpha/`（39 个 SCSS）——**仓库里唯一留存的 SCSS 源码** |
| `archive/V1.9/`（145 MB） | 30 个历史版本 CSS 快照（`theme-v1.9.0` – `theme-v1.11.0`） |
| `archive/legacy-artifacts/`（5 MB） | `obsidian.css` + `.map`：v0.5.4 Jordaan 的过期副本，**不是**当前产物 |
| `archive/img/`（29 MB） | 早期版本截图（README 未引用） |

`archive/` 在 `.gitignore` 中被忽略，**不进入版本控制**；它只作为本地考古材料存在。

> ⚠️ **clone 之后 `archive/` 是不存在的。** 本文件提到这些历史文件，但它们只存在于最初做归档的那台机器上。如果你需要长期保存历史版本，正确做法是 **放到 GitHub Release 的附件里，或建一个独立仓库**——不要指望本地 `archive/`，它随时可能被清理，也无法通过 clone 获得。

`img/Willemstad-X.png` 是唯一保留在仓库内的截图（主题主视觉资产，README 重写 / Release 说明会用）。

---

## 8. 常见改动流程

### 改一处样式

1. 在 `src/` 里找到对应模块的分片（用命名空间定位：配色找 `colour/`，标签页找 `app-ui/`，社区插件适配找 `plugins/community/`）；
2. 编辑分片（分片本身是 LF，编辑器别自动转 CRLF）；
3. `pnpm build` 重新生成 `theme.css`；
4. `pnpm run build:check` 应为通过（它校验的是"磁盘产物 == 源码构建结果"）；
5. `pnpm test`。

### 新增一个样式分片（新人最常做的操作）

三步，一行命令一个：

```bash
# 1. 在入口清单的【正确位置】加一行 include（位置 = 级联位置，不是追加到末尾！）
#    src/entries/theme.css:
#    /*@include <dir>/<file>.css */

# 2. 重新构建，产出 theme.css
pnpm build

# 3. 确认 src/ 与 theme.css 一致（CI 也跑这个）
pnpm run build:check
```

完整例子——假设要在 `colour/` 末尾加一个「高对比度调色板」分片：

```css
/* 1) 新建 src/colour/039a-ch00.css（UTF-8 无 BOM，LF 换行——与现有分片一致） */
:root {
  --ch00-contrast-ratio: 7;
}
```

```css
/* 2) 编辑 src/entries/theme.css，插到 colour 段落末尾、app-ui 段落之前 */
/*@include colour/039-cx00.css */
/*@include colour/039a-ch00.css */   ← 新增这行
/*@manifest ---- app-ui -------------------------------------------------- */
```

```bash
pnpm build && pnpm run build:check   # 3) 构建 + 校验
```

**几个容易踩的点：**

- **位置比文件名重要。** `extract.mjs` 生成的全局序号前缀（`000-`…`136-`）只是为了目录可读，真正的顺序完全由入口文件的 include 顺序决定。放错位置 = 级联顺序变了 = 渲染结果变了。
- **序号不要重排。** 序号是**全局**递增的（`app-ui` 从 `040` 开始），所以往中间插一个分片时，用带字母后缀的名字（`039a-`）比给后面 100 个文件重命名划算得多——重命名会让 diff 变得无法审阅，而序号本身不参与构建。
- **必须真的被 include。** 只在 `src/` 里新建文件而不加 include，构建不会报错，但那段 CSS 永远不生效——这是清单驱动构建的静默失败模式。`pnpm run build:audit` 专门抓这个（报 `orphans`）。
- **分片必须可独立解析。** 不能有跨文件的未闭合注释；`--audit` 会检查每个分片是否在自己的文件内闭合。
- **换行用 LF，与现有分片一致。** 产物换行由构建统一转 CRLF，源码分片的换行不影响输出（详见第 5 节）。

### 改版本号

版本号出现在三处，必须同步：`manifest.json` 的 `version`、`versions.json` 的对应键（值为 `minAppVersion`）、以及样式表内渲染的版本文案（源自 `src/meta/000-aa01.css`）。

```bash
pnpm run bump 1.12.0 --min-app 1.13.0   # 改写源 + 重建 + 复跑校验
pnpm run check:version                   # 只校验
```

`bump-version.mjs` 改的是 **`src/` 里的版本 token**，再重建产物，所以 `build --check` 天然保持通过。

> `check:version` 现在**是绿的**。上游遗留的 `versions.json` 不一致（[KNOWN-ISSUES.md](KNOWN-ISSUES.md) #1）已按「以 Obsidian 1.13 为准」修复，该检查已收回 `verify` 门禁。

---

## 9. 已知限制

- `src-publish/` 尚未建立，`publish.css` 仍是历史遗留文件；构建在 `src-publish/publish.css` 缺失时**不覆盖**它，因此 Publish 轨道暂未纳入统一构建。
- 分片命名保留原主题的两字母命名空间（`AB01`、`PC120`…）以便与历史 `theme.css` 对照，可读性依赖模块目录而不是文件名。
- 入口清单中存在同名分节（如两个 `043/044-da02`、两个 `122/123-pc120`），这是原 `theme.css` 里确实有两段同名分节；`extract.mjs` 用全局序号前缀保证文件名不冲突，但**不要**据此认为可以合并它们——它们处在级联中的两个不同位置。
- `src/` 分片是 LF、产物是 CRLF，这是设计而非疏漏，详见第 5 节。
- 有 4 个自定义属性引用但未在主题内定义，判定为**外部提供**（Kanban 插件 / Obsidian / Electron / Pickr 库）；本环境无法抓取 Obsidian 的 `app.css` 做权威核对，故只在 `tests/fixtures/obsidian-builtins.json` 的 `externallyProvided` 中登记，未改 CSS。详见 [KNOWN-ISSUES.md](KNOWN-ISSUES.md) 的「Remaining」。
- 8 个缺陷的修复中，**只有 3 处改变渲染**（两处 `--opp-*` 对比度模式、一处 infobox 标题背景），其余为元数据、死代码或标签纠正。清单见 [KNOWN-ISSUES.md](KNOWN-ISSUES.md) 开头的「Which fixes you should eyeball」。
