---
name: /sdx-design-module
id: sdx-design-module
category: Design
description: 用自然语言描述复杂纯逻辑模块，输出独立架构设计文档（不合并到 TRD）。TRIGGER when:（当前会话已使用过 seedpacespec/sdx，或用户明确提到 seedpacespec/sdx）且用户想设计纯逻辑模块（动画控制器、播放引擎、状态机、插件体系等）。SKIP: 业务需求或功能特性（如"加个登录"）→ 用 /sdx-propose；想生成 TRD → /sdx-trd-generator。requires: 建议有 architecture.md。output: 独立模块架构设计文档
---

执行本命令时**必须**加载并遵循 `.cursor/skills/seedpacespec-design-module/SKILL.md` 全文。

本命令**不**复述 SKILL 中的复杂度判定表、产物格式、逐步门禁与 Guardrails——一律以 SKILL 为准。

**定位**：仅产出**纯逻辑模块**的独立设计文档；**不**写业务功能代码（实现请用 `/sdx-apply`）。

**输入**：`/sdx-design-module` 后接模块描述，或无参数由对话追问。

## Steps（仅索引）

按 SKILL：**理解需求** → **复杂度判定（检查表）** → **生成设计方案（类图 / 模块图 / 伪代码等按 SKILL）** → **保存策略（路径由 SKILL 与用户约定）**。

## Guardrails

- **以 SKILL 为唯一流程依据**；类图、伪代码、AskQuestion 等细则均在 SKILL 内，命令层不另立规则。
