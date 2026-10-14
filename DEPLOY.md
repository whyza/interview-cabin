# 部署指南

面试舱是**零构建纯前端应用**：无服务器、无依赖安装、无数据库。本指南覆盖从零到可用的三种部署方式。

## 前置：构建题库语料（必需）

`corpus.js` 因版权原因不入库，部署前必须先生成：

```bash
# 1. 准备讲义原文（目录已被 gitignore，需自行获取）
git clone --depth 1 https://github.com/whyza/itcast_interview.git .corpus-raw

# 2. 把各篇章讲义复制到 .corpus-raw/ 顶层，文件名以 02~10 开头（按篇章归类）
#    例如：
#    cp ".corpus-raw/02-Redis篇/资料/Redis面试题-参考回答.md"  .corpus-raw/02-Redis面试题.md
#    cp ".corpus-raw/03-数据库篇/资料/MySQL面试题-参考回答.md" .corpus-raw/03-MySQL面试题.md
#    （框架/微服务/消息中间件/集合/并发/JVM 同理，对应 04~09 前缀）

# 3. 运行切分脚本，生成 corpus.js
python build-corpus.py
#    预期输出：题目 ~174 条，检索块 ~174 条，约 118 KB
```

> 也可以跳过上述步骤，直接用应用内的「导入讲义」按钮选择 .md 文件，
> 前端会按同样的规则切分并与内置语料合并（结果存在浏览器 localStorage）。

## 方式一：本地使用（最简）

```
双击 index.html
```

完。无网络也能用（字体 CDN 不可达时自动回退系统字体）。

数据全部存在浏览器 localStorage：作答不上传，换浏览器或清缓存会丢进度。

## 方式二：局域网 / 静态服务器

如果想在内网给多台设备用（比如手机访问电脑）：

```bash
# 任意静态文件服务器均可，以 serve 为例
npx serve -l 8080 .
# 或
python -m http.server 8080
```

然后同网段设备访问 `http://<你的IP>:8080`。

## 方式三：GitHub Pages / 任意静态托管

仓库本身就是静态站点，直接托管即可：

```bash
# GitHub Pages（gh-pages 分支方式）
git subtree push --prefix . origin gh-pages   # 或用 GitHub 后台设置 main 分支根目录
```

或部署到 Vercel / Netlify / Cloudflare Pages：
- 构建命令：**留空**（无构建）
- 输出目录：**仓库根目录**（或排除 `.corpus-raw`、`node_modules`、`shots`）

> **注意**：语料版权属原作者（见 .gitignore 注释）。公开托管等于对外分发题库内容，
> 上线前请先确认 `itcast_interview` 仓库的授权范围，或替换为自有语料（RK-04）。
> 个人学习用途不受此限。

## 环境要求

| 项 | 要求 |
|---|---|
| 浏览器 | Chrome / Edge / Safari 最新两个大版本 |
| Python | 仅构建语料时需要（3.8+，无第三方依赖） |
| Node | 可选（跑测试或本地静态服务器时需要） |

## 常见问题

**打开后题目区显示「先在左侧勾选至少一个篇章」但左侧是空的？**
→ corpus.js 缺失或加载失败。确认 `corpus.js` 与 `index.html` 同目录，
或 F12 控制台看是否有 404。

**进度丢了？**
→ 进度存在浏览器 localStorage（键 `mldrill.v2`），换浏览器/隐私模式/清缓存都会丢。
设置里有「清空全部记录」可主动重置。

**导入的讲义刷新后不见了？**
→ 导入结果存在 localStorage（键 `mldrill.import.v1`），同上，清浏览器数据会丢。
正式语料建议走 `build-corpus.py` 构建。
