# Git 工作流

## 强制规则（必须遵守）

**禁止模型执行任何 Git 提交操作。** 包括但不限于：
- `git commit` — 禁止
- `git add` + `git commit` — 禁止
- 任何形式的代码提交、暂存、推送操作

提交代码必须由用户手动完成。模型仅可提供以下协助：
- 查看变更状态（`git status`、`git diff`）
- 分析变更内容
- 起草提交信息供用户参考
- 创建 PR（用户明确要求时）

## Pull Request 工作流

创建 PR 时：
1. 分析完整的提交历史（不仅仅是最新的提交）
2. 使用 `git diff [base-branch]...HEAD` 查看所有变更
3. 撰写全面的 PR 摘要
4. 包含带 TODO 的测试计划
5. 如果是新分支，推送时使用 `-u` 标志

## 提交信息格式（供用户参考）

当用户要求起草提交信息时，遵循以下格式：

```
<type>: <description>

<optional body>
```

类型: feat, fix, refactor, docs, test, chore, perf, ci

规则：
- 只输出提交信息本身，不要添加签名、标记或元信息
- 不要包含 "Generated with Claude Code"、"Co-Authored-By" 等署名内容
- 不要使用 emoji 表情符号
- 保持简洁专业的风格
