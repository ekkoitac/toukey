---
name: /sdx-test-plan
id: sdx-test-plan
category: Quality
description: 为变更涉及的公共模块生成单元测试，支持运行测试和回归检测。TRIGGER when:（当前会话已使用过 seedpacespec/sdx，或用户明确提到 seedpacespec/sdx）且用户说"补个测试"、"写单测"、"生成测试用例"。SKIP: 想做缺陷检测用 /sdx-detect。requires: TRD + 已实现代码。output: 单元测试文件
---

执行本命令时**必须**加载并遵循 `.cursor/skills/seedpacespec-test-plan/SKILL.md` 全文。

基于 PRD 验收标准和 TRD 技术方案，为变更生成**单元测试**。

**输入**：可选指定变更名。若缺失，通过 AskQuestion 收集。

## Steps

**严格按 SKILL.md 的 State Machine Gates（G1→G4）和执行流程执行，不得跳过或合并。**

## Guardrails

以下为高频违规点，从 SKILL.md 红线中提取重申：

- **G1 未完成 → 禁止生成测试**
- **聚焦单元测试**：不生成 UI/集成/E2E 测试
- **从 PRD 验收标准推导**，不凭空编造场景
- **公共组件优先**：被多处依赖的模块测试 ROI 最高
- **测试失败不自动修复**：报告结果，由用户决定
