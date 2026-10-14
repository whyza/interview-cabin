# 开发规范与 AI 协作约定

> 本目录收录本项目开发遵循的编码规范与 Claude Code 协作配置，换机器 clone 后按「使用方式」恢复即可。

## 目录结构

```
docs/conventions/          全局编码规范（原样收录）
├── workflow.md            开发工作流程（分析规划 → 行动清单 → 执行 → 自查）
├── coding-style.md        编码风格（分层、注释、MyBatis Plus、循环/批量、检查清单）
├── agents.md              Agent 编排规则（review 类必须用户明确要求）
├── git-workflow.md        Git 约束（禁止模型执行提交，仅可起草信息）
└── security.md            安全检查清单（密钥、注入、校验、脱敏）

.claude/skills/            通用 Claude Code skills（项目级，clone 即生效）
├── tdd-workflow/          测试驱动开发流程
├── test-case-writing/     测试用例设计
├── security-review/       安全审查清单
├── prompt-optimizer/      提示词优化
├── pdf-extraction/        PDF 内容提取
├── agent-browser/         浏览器自动化
└── find-skills/           技能发现
```

## 使用方式（新机器）

1. **规范生效**：把 `docs/conventions/*.md` 复制（或软链）到 `~/.claude/rules/`，
   Claude Code 会作为全局指令加载。
2. **Skill 生效**：仓库内的 `.claude/skills/` 在此项目打开时自动可用，无需安装。
3. **注意**：不含公司内部 skill（lark 系列、find-logs 等），那些只在本地环境存在。

## 项目级要点（与规范配合）

- 本仓库为**零构建前端项目**：`coding-style.md` 中 Java/MyBatis 部分适用于本项目的
  Spring Boot 后端规划（见 `面试舱-前后端架构设计.md` §7）；当前 JS 代码遵循其中
  通用原则（注释规范、禁止过度设计、错误处理）。
- Git 提交始终由用户手动完成或明确指示，模型仅起草提交信息（见 `git-workflow.md`）。
