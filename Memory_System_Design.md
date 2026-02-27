# 宠物记忆系统升级规划 (Memory System Design)

## 1. 现状与目标

### 1.1 现状分析
当前 `index.html` 中的宠物行为主要依赖**随机性**和**简单的状态机**：
*   **行为决策 (`decidePersonalityBehavior`)**：基于“内向/外向”+“感性/理性”的硬编码规则，缺乏连贯性。
*   **对话生成 (`triggerAIPetAction`)**：随机抽取预设文案，无法通过对话体现“记得上次去过哪里”。
*   **日记生成 (`generateDiaryWithAIGC`)**：仅依赖当前地点和性格，缺乏历史上下文的关联。

### 1.2 升级目标
构建一个**“双层记忆模型”**，使宠物具备：
1.  **连贯性**：记得用户喜欢什么（例如：总是晚上打卡 -> "又是深夜行动呢"）。
2.  **成长性**：随着打卡增多，对特定地点或行为产生独特反应（例如：第三次去武汉 -> "我对热干面的味道已经很熟啦"）。
3.  **场景感知**：根据当前场景（如：雨天、深夜、特定城市）检索相关记忆。

---

## 2. 核心架构设计

### 2.1 记忆类型定义

我们将记忆分为两层：**情景记忆 (Episodic)** 和 **语义记忆 (Semantic)**。

#### A. 情景记忆 (Episodic Memory)
*   **定义**：按时间顺序记录的具体事件流。
*   **存储**：`appState.memories.episodic` (Array)
*   **数据结构**：
    ```typescript
    interface EpisodicMemory {
      id: string;             // UUID
      timestamp: number;      // 事件发生时间
      type: 'TRAVEL' | 'INTERACT' | 'ACHIEVEMENT'; // 事件类型
      
      // 核心内容
      location?: string;      // 地点（仅 TRAVEL/ACHIEVEMENT）
      action?: string;        // 具体行为描述（如：抚摸、摇晃、打卡）
      emotion: string;        // 当时情绪 (excited, calm, tired)
      
      // 辅助上下文
      weather?: string;       // 天气（模拟或真实）
      timeOfDay?: string;     // 时段 (morning, night)
      objects?: string[];     // 相关物品（如：热干面、雨伞）
      
      // 摘要（用于快速检索）
      summary: string;        // "和伙伴在武汉打了卡，吃了热干面"
    }
    ```

#### B. 语义记忆 (Semantic Memory)
*   **定义**：从情景记忆中提炼出的“认知”或“统计事实”。
*   **存储**：`appState.memories.semantic` (Object / Map)
*   **数据结构**：
    ```typescript
    interface SemanticMemory {
      // 1. 地点偏好 (Location Cognition)
      locations: {
        [cityName: string]: {
          visitCount: number;     // 访问次数
          lastVisit: number;      // 上次访问时间
          impression: string[];   // 印象标签 (e.g., "辣", "热", "繁华")
        }
      };
      
      // 2. 用户习惯 (User Profiling)
      user: {
        activeTime: 'night_owl' | 'early_bird' | 'random'; // 活跃时间段
        interactionFrequency: 'high' | 'low';              // 互动频率
        favoriteRegion?: string;                           // 常去区域 (e.g., "华东")
      };
      
      // 3. 自我认知 (Self Awareness)
      self: {
        moodBaseline: number;   // 心情基线
        currentObsession?: string; // 最近沉迷的事物 (e.g., "想吃火锅")
      }
    }
    ```

---

## 3. 功能模块设计

### 3.1 记忆管理器 (`MemoryManager`)
我们需要在全局实现一个 `MemoryManager` 类，负责记忆的增删改查。

#### API 设计
```javascript
class MemoryManager {
    constructor(state) {
        this.state = state;
    }

    // 1. 记下刚刚发生的事
    remember(event: EpisodicEvent) {
        // 写入 episodic 数组
        // 触发 consolidate() 尝试更新 semantic
    }

    // 2. 回忆相关事情（用于 Prompt 注入）
    recall(context: ContextQuery): MemoryResult {
        // 根据 context.location 或 context.time 检索 episodic
        // 返回 Top-K 相关记忆摘要
    }

    // 3. 记忆固化（后台逻辑）
    consolidate() {
        // 统计 locations 访问次数 -> 更新 semantic.locations
        // 分析活跃时间 -> 更新 semantic.user.activeTime
    }
    
    // 4. 获取决策建议（用于 decidePersonalityBehavior）
    getBehavioralBias() {
        // 如果很久没旅游 -> 返回 { desire: 'travel', weight: 0.8 }
        // 如果是深夜 -> 返回 { desire: 'rest', weight: 0.9 }
    }
}
```

### 3.2 记忆检索算法 (Retrieval Algorithm)
为了在 Prompt 中注入最相关的记忆，采用简单的加权评分：
*   **Recency (时效性)**: 越新的记忆权重越高。
*   **Relevance (相关性)**: 地点匹配 (+100分), 时间段匹配 (+20分)。
*   **Emotional Intensity (情感强度)**: `excited` / `sad` 的记忆权重高于 `calm`。

---

## 4. 改造实施计划

### 步骤 1：基础设施建设
1.  修改 `appState`，初始化 `memories` 结构。
2.  实现 `MemoryManager` 类。
3.  在 `btnCheckin.click` (打卡成功) 和 `window.__triggerPetTapInteraction` (抚摸) 处插入 `memoryManager.remember(...)`。

### 步骤 2：记忆驱动的对话 (AI Prompt 升级)
修改 `generateDiaryWithAIGC` 和 `triggerAIPetAction`：
*   **Before**:
    > "你现在在武汉，写一篇日记。"
*   **After**:
    > 调用 `memoryManager.recall({ location: '武汉' })` 获得历史记忆。
    > Prompt: "你现在在武汉。**你记得上次来这里是30天前，当时吃了很多辣的。** 请结合这份回忆写一篇日记，体现出‘故地重游’的感觉。"

### 步骤 3：记忆驱动的行为 (Behavior Engine 升级)
修改 `decidePersonalityBehavior(trigger)`：
1.  获取 `memoryManager.getBehavioralBias()`。
2.  **新逻辑示例**：
    ```javascript
    const memoryBias = memoryManager.getBehavioralBias();
    
    // 记忆系统强烈建议休息 (比如深夜模式)
    if (memoryBias.type === 'rest' && memoryBias.weight > 0.8) {
        return { type: 'rest', context: '太晚了，我想睡了' };
    }
    
    // 记忆系统建议重游 (比如在房间里发呆太久，且上次旅行很久以前)
    if (memoryBias.type === 'travel_craving') {
        return { type: 'moveToHotspot', hotspot: 'door', context: '好久没出门了，想去旅行！' };
    }
    ```

---

## 5. 预期效果示例

| 场景 | 原有表现 | **升级后表现** |
| :--- | :--- | :--- |
| **第二次去成都** | "成都很棒！火锅很好吃。" (通用模板) | "又闻到熟悉的火锅味了！上次来成都还是上个月，这次我们要去哪里玩？" (关联历史) |
| **深夜打开 App** | 随机发呆或兴奋乱跳 | "哈欠...这么晚了还不睡吗？我都困了..." (基于用户习惯/时间感知) |
| **连续三天没打卡** | 只有随机发呆 | 频繁走到门口徘徊，气泡弹出："是不是该出去走走了？" (基于最后一次旅行时间的差异) |

## 6. 下一步行动
请确认此规划文档。确认后，我将优先实现 `MemoryManager` 类并挂载到全局 `appState` 中。
