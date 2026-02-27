# 记忆系统优化规划 (Memory Enhancement Plan)

基于 `index.html` 的现有架构与 "人格第一，功能第二" 的核心理念，我们将重构宠物的记忆系统，使其行为与对话真正由记忆驱动，而非简单的随机或硬编码逻辑。

## 1. 记忆模型设计 (Memory Model)

将 `appState.memories` 扩展为更结构化的双层记忆系统：

### 1.1 情景记忆 (Episodic Memory)
记录具体的“事件流”，包含时间、地点、行为与当时的情绪快照。
*   **结构定义**:
    ```javascript
    {
        id: "evt_12345",
        timestamp: 1708992000000,
        type: "TRAVEL" | "INTERACT" | "EAT" | "REST",
        location: "武汉", // 若适用
        summary: "和伙伴一起去武汉吃了热干面",
        emotion: "excited", // 当时的情绪状态
        tags: ["food", "travel", "wuhan"],
        relatedImage: "assets/scenes/wuhan.png" // 可选
    }
    ```
*   **来源**:
    *   旅行打卡 (Check-in)
    *   用户抚摸/互动 (Interaction)
    *   物品收集 (Cabinet)

### 1.2 语义记忆 (Semantic Memory)
从情景记忆中提炼出的“事实”与“偏好”，构成宠物的世界观与对用户的认知。
*   **结构定义**:
    ```javascript
    {
        subject: "user" | "self" | "location:武汉",
        predicate: "likes" | "has_visited" | "is_afraid_of",
        object: "spicy_food",
        confidence: 0.8, // 置信度，随重复事件增强
        lastUpdated: 1708992000000
    }
    ```
*   **示例**:
    *   (User, likes, spicy_food) <- 推理自多次在川渝地区打卡
    *   (Self, feels_safe, home) <- 初始设定或强化
    *   (User, travels_frequency, high) <- 统计得出

## 2. 记忆驱动的行动系统 (Memory-Driven Action System)

改造 `decidePersonalityBehavior` 与 `triggerAIPetAction`，使其输入参数包含相关记忆。

### 2.1 决策循环 (Decision Loop)
在 `scheduleInactivityFlow` (15秒无操作) 触发时，不再仅依赖 `energy/emotion` 矩阵，而是先查询记忆：

1.  **查询 (Query)**: "最近有什么未处理的情绪？" "今天是特殊的日子吗？" "这里（当前地点）以前来过吗？"
2.  **加权 (Weighing)**:
    *   *新鲜感*: 如果是新地点 -> 触发 `EXPLORE` 行为。
    *   *怀旧*: 如果是老地点 -> 触发 `RECALL` 行为（"上次来这里还是...").
    *   *习惯*: 如果通常这个时间在休息 -> 触发 `REST` 行为。
3.  **执行 (Execute)**: 选定行为并播放对应动画。

### 2.2 记忆检索机制 (Retrieval Mechanism)
实现一个轻量级的 `MemoryManager`：
*   `remember(event)`: 存入情景记忆，并尝试更新语义记忆（简单的规则推理）。
*   `recall(context)`: 根据当前上下文（地点、时间、状态）检索最相关的 top-k 记忆。

## 3. 实施步骤

### 阶段一：数据结构与存储 (Infrastructure)
1.  在 `appState` 中完善 `memories` 结构。
2.  实现 `MemoryManager` 类，提供 `addEpisodic` 和 `getRecentMemories` 方法。
3.  在“打卡成功”、“抚摸”等关键事件处插入 `MemoryManager.addEpisodic()` 调用。

### 阶段二：记忆驱动的对话 (Contextual Dialogue)
1.  修改 `triggerAIPetAction`，在调用 LLM (或本地模板) 前，先调用 `MemoryManager.recall(currentLocation)`。
2.  将检索到的记忆片段注入 Prompt 或模板变量中。
    *   *Before*: "我到了武汉！"
    *   *After*: "又回到武汉了！上次吃的热干面味道我还记得呢！" (基于 `visited_count > 1`)

### 阶段三：记忆驱动的行为 (Behavioral Adaptation)
1.  重构 `decidePersonalityBehavior`。
2.  引入“记忆触发器”：
    *   例如：如果在 `cabinetItems` 中有“雨伞”，且天气（模拟）下雨，宠物会自动拿出雨伞。
    *   例如：如果连续三天没有“旅行”记忆，宠物会表现出“Bored”状态（频繁走到门口）。

## 4. 示例代码预览

```javascript
class MemoryManager {
    constructor(state) {
        this.episodic = state.memories.episodic;
        this.semantic = state.memories.semantic;
    }

    addEpisodic(event) {
        const memory = {
            id: Date.now().toString(36),
            timestamp: Date.now(),
            ...event
        };
        this.episodic.unshift(memory); // 最新在在最前
        this.consolidate(memory); // 尝试转化为语义记忆
    }

    // 简单的规则推理，将情景转化为语义
    consolidate(event) {
        if (event.type === 'TRAVEL') {
            // 更新地点的访问次数
            let sem = this.semantic.find(s => s.subject === `location:${event.location}` && s.predicate === 'visit_count');
            if (sem) {
                sem.object = (parseInt(sem.object) + 1).toString();
            } else {
                this.semantic.push({
                    subject: `location:${event.location}`,
                    predicate: 'visit_count',
                    object: '1',
                    confidence: 1.0
                });
            }
        }
    }
    
    // 基于当前上下文获取行动建议
    suggestAction(currentContext) {
        // 检查是否很久没出门
        const lastTravel = this.episodic.find(e => e.type === 'TRAVEL');
        if (!lastTravel || (Date.now() - lastTravel.timestamp > 3 * 24 * 3600 * 1000)) {
            return { type: 'desire_travel', weight: 0.8 };
        }
        return { type: 'idle', weight: 0.1 };
    }
}
```
