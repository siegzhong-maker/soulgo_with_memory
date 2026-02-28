# 记忆机制与 LLM 接入设计

## 一、当前机制梳理

### 1. 什么时候会记忆（触发时机）

| 触发场景 | 代码位置 | 说明 |
|----------|----------|------|
| **打卡成功** | 打卡流程中，`generateDiaryEntry` 之后、若 `diaryMeta.diaryId` 存在则调用 `appendEpisodicMemory` | 用户输入地点并点击「去打卡」→ 生成日记 → **立即写入一条旅行情景记忆**。仅此一处会新增「旅行记忆」。 |
| **首次打开宠物记忆页** | `ensureMemorySeeds()` 在打开「宠物记忆」弹窗时被调用 | 若当前没有任何旅行/日常记忆，会写入**种子数据**（温馨小屋、杭州高铁、以及一条「打开记忆本」的日常记忆）。这些是静态示例，不是用户行为触发的。 |

目前**没有**根据「用户打开记忆本」「用户深夜使用」等行为实时调用 LLM 或追加新记忆；日常记忆仅来自种子。

### 2. 记忆什么（写入内容）

- **旅行记忆**（`appendEpisodicMemory`）：
  - 输入：`date`（日记日期）、`location`（用户输入城市）、`scene`（本次掉落的场景资产）、`diaryId`。
  - **没有**把本次 AIGC 生成的日记正文 `diaryText` 传入。
  - 内部用 `buildEpisodicSummary` **纯前端模板**按「城市 + 同城 flavor 高亮点 + 时间段 + 性格」生成一句 `summary` 和 `emotion`，例如：
    - 小火苗：`下午在南京一路蹦蹦跳跳，差点把照片都晃糊了。` + emotion `excited`
    - 小云朵：`下午在潮州慢慢走慢慢看，把安静的风景都藏进心里。` + emotion `tender`
  - 因此**同一性格在同一时段**下，不同城市的记忆只有地名不同，其余句式完全一致，即你看到的「通用模板」问题。

- **日常记忆**：目前仅种子里有 `source_event: 'open_memory_page'` 等，没有在用户「打开记忆本」「深夜进入」等时机真正调用逻辑去追加。

### 3. 用记忆来干嘛（消费场景）

| 用途 | 代码位置 | 说明 |
|------|----------|------|
| **写旅行日记** | `generateDiaryWithAIGC` 内构造 `memoryText` | 从 `getEpisodicTravel()` 取旅行记忆，按当前打卡地点过滤出最多 2 条，格式化为 `日期 城市 时间段 —— summary` 注入 prompt 的【宠物记忆】。模型被要求「有机会自然提一句与过往旅行的关联」，从而在日记里体现「记得」。 |
| **宠物房间气泡** | 生成宠物发言的 `generateText` 中 | 约 25% 概率从「旅行记忆前 2 条 + 日常记忆前 1 条」里随机抽一条的 `narration/text` 作为气泡文案，让宠物偶尔「复述」记忆中的一句话。 |
| **宠物记忆页展示** | `renderMemories` / `makeEpisodicCard` | 在「旅行记忆」Tab 下列出所有旅行/日常情景记忆，展示日期、时间段、标题（打卡 城市）、`summary`、情绪 Tag，支持编辑。 |
| **记忆墙** | `renderMemoryWall` | 用 `appState.cabinetItems`（橱柜物品）渲染拍立得，点击进日记；这里**不是**直接读 `memories.episodic`，而是橱柜数据。 |

---

## 二、问题归纳

1. **记忆内容同质化**：旅行记忆仅靠 `buildEpisodicSummary` 的 4 种性格 × 1 种句式，只换城市/高亮点，没有结合本次日记内容或真实行为。
2. **记忆触发单一**：只有「打卡成功」会写旅行记忆；没有在「打开记忆本」「使用时长」「特定时段」等行为上做增量记忆或习惯推断。
3. **记忆与日记脱节**：写日记时已经生成了 `diaryText`，但写入记忆时没有用它，而是重新用模板生成一句，导致「日记里写的是腐乳饼，记忆里写的是蹦蹦跳跳」的割裂。

---

## 三、用大模型重新设计记忆的总体思路

### 1. 触发时机（何时调用 LLM）

建议在**现有唯一写旅行记忆的时机**先做实：**打卡成功、且已生成日记正文之后**。

- **主流程**：用户打卡 → 调用 `generateDiaryWithAIGC` 得到 `diaryText` → 生成日记卡片 → 调用「记忆生成接口」：把 `diaryText`、`location`、`date`、`time_slot`、`personality` 等作为输入，**请求 LLM 生成一条 30～50 字的记忆摘要 + 一个情绪标签**，再写入 `appendEpisodicMemory`（或新函数，例如 `appendEpisodicMemoryFromLLM`）。
- **可选扩展**：
  - 用户**打开宠物记忆页**时：若距离上次写入已有一段时间，可调用 LLM 根据「最近几条旅行记忆 + 最近行为」生成一条**日常/习惯类**记忆（例如「最近你总在睡前打开记忆本」），再追加到 `episodic` 的 daily 类。这需要后端或前端能拿到「最近打开时间」等简单行为统计。
  - 其他行为（如「连续 N 天打卡」「某时段活跃」）也可作为后续触发条件，在文档中预留即可。

### 2. 记忆什么（LLM 的输入与输出）

- **输入**（给 LLM 的上下文）：
  - 必选：`diaryText`（本次日记正文）、`location`（城市）、`date`、`time_slot`、当前 `personality`（如小火苗）。
  - 可选：最近 1～2 条旅行记忆的 `summary`（便于 LLM 写出「和上次不同」的侧重点）。
- **输出**（结构化，便于写入与注入）：
  - `summary`：一句 30～50 字的第一人称小结，描述**宠物在这个地点的表现/感受**（可包含当地特色，如腐乳饼、角楼），不要泛泛的「蹦蹦跳跳」。
  - `emotion`：在给定枚举里选一，如 `excited` / `tender` / `curious` / `nostalgic` / `calm`。
- **存储**：与现有一致，写入 `appState.memories.episodic` 一条 record，包含 `date`、`location_city`、`location_spot`、`time_slot`、`personality`、`summary`、`emotion`、`diaryId`、`scene` 等；**不再**用 `buildEpisodicSummary` 的模板生成 `summary`。

这样，**记忆内容由本次日记与地点驱动**，既避免通用模板，又控制单条长度，便于后续注入写日记/气泡时控制 token。

### 3. 用记忆来干嘛（消费不变，内容变好）

- **写旅行日记**：仍从 `getEpisodicTravel()` 取记忆，按地点过滤后格式化为「日期 城市 时间段 —— summary」注入 prompt；因为 summary 已是 LLM 生成的、与日记内容一致的精炼句，模型更容易在下一篇日记里自然呼应「上次在潮州吃了腐乳饼」之类。
- **宠物气泡**：仍可 25% 概率用记忆的 `narration`/`text` 作为气泡；由于 narration 现由 LLM 生成，会更多样、更贴合具体经历。
- **宠物记忆页 / 编辑**：展示与编辑逻辑不变，仅数据来源从「模板」改为「LLM 生成 + 用户可编辑」。

---

## 四、实现要点（接入大模型）

### 1. 新增一次 LLM 调用：生成单条旅行记忆摘要

- **时机**：在打卡流程中，`generateDiaryEntry(location, diaryText, scene, memoryCountForHint)` 之后、`appendEpisodicMemory` 之前（或替换其内部生成逻辑）。
- **输入**：
  - 系统 prompt：限定角色为「把一段旅行日记压缩成一句宠物视角的记忆摘要」，要求 30～50 字、第一人称、只保留地点/时间/宠物在该地的表现或感受，并输出一个 emotion。
  - User 内容：`diaryText`、`location`、`date`、`time_slot`、`personality`；可选带最近 1 条旅行记忆的 summary 作参考。
- **输出**：解析为 `{ summary: string, emotion: string }`；若解析失败或超时，**回退**到现有 `buildEpisodicSummary` 模板，保证一条记忆仍会被写入。
- **写入**：用返回的 `summary` 和 `emotion` 调用现有 `appendEpisodicMemory` 的写入逻辑（或扩展 `appendEpisodicMemory` 支持传入 `summary`/`emotion`，内部不再调 `buildEpisodicSummary`）。

### 2. 接口与安全

- 若已有 `/api/chat` 代理 OpenRouter，可新增一个专用 endpoint，例如 `POST /api/memory-summary`，请求体包含 `diaryText`、`location`、`date`、`time_slot`、`personality`，返回 `{ summary, emotion }`；前端在打卡流程里 `await fetch('/api/memory-summary', ...)` 后再写入记忆。
- 这样 Key 仍在服务端，不暴露给前端；且记忆生成与日记生成可分开限流、降级。

### 3. Token 与成本

- 单次记忆生成：输入约 200～400 字（日记片段 + 元数据），输出约 50 字 + 一个词，单次成本可控。
- 写入记忆时**不再**把整篇日记存进 `episodic`，只存 LLM 产出的 `summary`，因此后续「写日记」「气泡」注入的仍是短句，总 token 与当前设计相当，不会因引入 LLM 而暴涨。

---

## 五、小结表

| 维度 | 当前 | 接入 LLM 后 |
|------|------|-------------|
| **何时记忆** | 仅打卡成功写入一条旅行记忆；日常记忆靠种子 | 仍以打卡成功为主；可选在打开记忆页等时机用 LLM 补日常/习惯记忆 |
| **记忆什么** | 模板句：城市 + 时间段 + 性格对应一句固定句式 | 用本次 `diaryText` + 地点 + 时间 + 性格 调用 LLM 生成 30～50 字 summary + emotion |
| **用记忆干嘛** | 注入写日记 prompt、宠物气泡、记忆页展示 | 不变；因 summary 更贴合当次经历，写日记与气泡的「记忆感」更强 |
| **回退** | 无 | LLM 超时/失败时回退到现有 `buildEpisodicSummary`，保证仍写入一条 |

按上述方式接入大模型后，记忆机制仍然是「打卡触发、写入一条、多场景消费」，但**记忆内容**从通用模板变为「本次日记的压缩版」，既解决同质化，又保留地点一致、低 token 的设定。

---

## 六、Mem0 风格提示词设计（参考 [mem0ai/mem0](https://github.com/mem0ai/mem0)）

Mem0 的 [Custom Fact Extraction Prompt](https://docs.mem0.ai/open-source/features/custom-fact-extraction-prompt) 采用：**领域聚焦 + 少样本示例 + 严格 JSON 输出**。针对 SoulGo 的旅行记忆抽取，做如下适配。

### 1. Mem0 核心思路

- **信息抽取**：LLM 从对话/文本中抽取值得记忆的 facts，而非整段存储。
- **冲突解决**：新事实与已有记忆比对，决定 ADD/UPDATE/DELETE/NONE（SoulGo 当前仅 ADD，可后续扩展）。
- **少样本**：用 Input/Output 示例教会模型「抽什么、不抽什么」。
- **负例**：明确哪些输入应返回空，避免无关内容进入记忆。

### 2. SoulGo 记忆抽取 Prompt 模板

**角色与任务**：从一段宠物旅行日记中抽取**一条**记忆摘要 + 情绪标签，供后续写日记、气泡时检索使用。

**输出格式**：仅返回 JSON，`{"summary": "30～50字第一人称小结", "emotion": "excited|tender|curious|nostalgic|calm"}`。

**少样本示例**（Input = 日记正文 + 元数据，Output = JSON）：

```
Input:
日记：今天在潮州牌坊街，阳光晒得石板路发亮。我蹲在腐乳饼店门口，闻着刚出炉的香气，尾巴都翘起来了～和主人一起慢慢走，把老街的每一块砖都记在心里。
地点：潮州 | 时间：午后 | 性格：小云朵

Output: {"summary": "午后在潮州牌坊街，蹲在腐乳饼店门口闻香气，和老街的砖块一起晒太阳。", "emotion": "tender"}

---

Input:
日记：南京夫子庙人好多！我一路小跑，差点把相机晃糊。在秦淮河边停下来，看着灯笼一盏盏亮起来，感觉整条河都在发光～
地点：南京 | 时间：傍晚 | 性格：小火苗

Output: {"summary": "傍晚在南京夫子庙一路小跑，秦淮河边看灯笼亮起，整条河都在发光。", "emotion": "excited"}

---

Input:
日记：香港维港的夜景太震撼了。我趴在栏杆上，记下每栋楼的高度和灯光颜色，回去要画一张示意图。
地点：香港 | 时间：晚上 | 性格：小灯泡

Output: {"summary": "晚上在维港趴在栏杆上，记下每栋楼的高度和灯光颜色，准备回去画示意图。", "emotion": "curious"}
```

**负例**（应回退到模板或返回空，不强行抽取）：

```
Input: 日记：（空或极短，如「今天去了南京。」）
Output: 不调用 LLM，直接使用 buildEpisodicSummary 模板。
```

### 3. 抽取规则（写入 Prompt 的指令）

1. **只抽取**：宠物在该地点的**具体行为/感受**，可包含当地特色（腐乳饼、秦淮河、维港灯光等）。
2. **不抽取**：泛泛的「蹦蹦跳跳」「慢慢走」等模板句；与本次地点无关的内容。
3. **summary**：30～50 字，第一人称「我」，与日记正文语义一致、可自然呼应。
4. **emotion**：严格从 `excited` / `tender` / `curious` / `nostalgic` / `calm` 中选一，与性格和内容匹配。

### 4. 与 Mem0 的对应关系

| Mem0 概念 | SoulGo 适配 |
|-----------|-------------|
| `custom_fact_extraction_prompt` | 上述「角色 + 少样本 + 抽取规则」 |
| `facts` 数组 | 单条记忆 → 一个 `{summary, emotion}` 对象 |
| 负例（空输出） | 日记过短时跳过 LLM，用 `buildEpisodicSummary` 回退 |
| `custom_update_memory_prompt` | 当前仅 ADD；若未来支持「同城记忆去重/更新」可引入 UPDATE 逻辑 |

### 5. 实现时的 Prompt 组装

- **系统 prompt**：已写入 `index.html` 常量 `MEMORY_EXTRACTION_SYSTEM`。
- **用户 prompt**：`日记：${diaryText}\n地点：${location} | 时间：${time_slot} | 性格：${personality}\n请抽取一条记忆。`
- **输出解析**：`JSON.parse` 取 `summary`、`emotion`；失败则回退 `buildEpisodicSummary`。
- **写入**：`appendEpisodicMemory({ ..., summary, emotion })` 已支持可选参数，传入则跳过模板。
