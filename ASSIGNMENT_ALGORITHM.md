# 智能行程分配算法说明

## 概述

本项目实现了基于地理距离和时长均衡的智能行程分配算法，用于将地点池自动分配到多天行程中。

## 核心算法

### 1. Haversine 球面距离计算

使用 Haversine 公式计算两个经纬度坐标之间的球面距离（单位：千米）：

```javascript
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // 地球半径（千米）
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * 
    Math.cos((lat2 * Math.PI) / 180) * 
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
```

### 2. 分配评分机制

对每个地点，计算其分配到各天的综合评分：

```
score = 距离(km) + 超载惩罚
超载惩罚 = max(0, 当天已分配时长 + 地点时长 - 目标时长) × 0.05
```

**优先级**：
- 距离权重高（主导因素）
- 时长均衡作为辅助调节

**参数**：
- `targetDailyMin = 420` (7小时，理想每天游览时长)
- `maxDailyMin = 540` (9小时，硬性上限)

### 3. 特殊规则

#### 餐厅处理
- 优先分配到**景点数量最多**的那天
- 理由：餐厅通常作为晚餐，应在有景点的当天安排

#### 未解析坐标
- 餐厅类型：分配到时长较少的那天
- 其他类型：默认分配到第一天

## 算法流程

1. **初始化**
   - 为每天创建时长计数器 `dailyMinutes[]`
   - 获取所有酒店的地理坐标

2. **主循环分配**
   ```
   对每个地点:
     如果 地点已解析坐标:
       计算到各天酒店的距离
       计算各天的综合评分（距离 + 超载惩罚）
       选择评分最低的天（优先距离近，其次时长均衡）
     否则:
       按类型策略分配（餐厅→时长少的天，其他→第一天）
     
     更新该天的时长计数
   ```

3. **后处理优化**
   - 识别所有餐厅
   - 统计各天景点数量
   - 将餐厅重新分配到景点最多的那天

## 示例

### 输入
```json
{
  "inputPlaces": [
    { "name": "浅草寺", "type": "景点", "lat": 35.7147651, "lng": 139.7966553, "visitDuration": 90 },
    { "name": "代代木公园", "type": "景点", "lat": 35.6700649, "lng": 139.6949656, "visitDuration": 60 },
    { "name": "横滨红砖仓库", "type": "景点", "lat": 35.4526321, "lng": 139.6428944, "visitDuration": 90 },
    { "name": "一兰拉面", "type": "餐厅", "lat": null, "lng": null, "visitDuration": 45 }
  ],
  "daySetups": [
    { "dayName": "D1", "hotel": "APA Hotel Asakusa Tawaramachi Ekimae" },
    { "dayName": "D2", "hotel": "SOTETSU HOTELS THE SPLAISIR YOKOHAMA" }
  ]
}
```

### 输出
```json
{
  "assignments": [
    { "name": "浅草寺", "dayIndex": 0, "reason": "距离D1酒店0.5km，顺路且时长均衡" },
    { "name": "代代木公园", "dayIndex": 0, "reason": "距离D1酒店10.1km，顺路且时长均衡" },
    { "name": "横滨红砖仓库", "dayIndex": 1, "reason": "距离D2酒店2.4km，顺路且时长均衡" },
    { "name": "一兰拉面", "dayIndex": 0, "reason": "餐厅安排在D1晚间用餐" }
  ]
}
```

### 分析
- **浅草寺**：距离 D1 酒店（浅草）仅 0.5km → 分配到 D1
- **代代木公园**：距离 D1 酒店 10.1km，距离 D2 酒店 31.8km → 分配到 D1
- **横滨红砖仓库**：距离 D2 酒店（横滨）仅 2.4km → 分配到 D2
- **一兰拉面**：D1 有 2 个景点，D2 有 1 个景点 → 分配到 D1 晚餐

**结果**：
- D1: 浅草寺(90min) + 代代木公园(60min) + 一兰拉面(45min) = 195min
- D2: 横滨红砖仓库(90min) = 90min

## API 接口

### POST /api/assign-places

**请求体**：
```json
{
  "inputPlaces": [
    {
      "name": "地点名",
      "type": "景点|餐厅|商场|其他",
      "visitDuration": 90,
      "geocoded": true,
      "lat": 35.123,
      "lng": 139.456
    }
  ],
  "daySetups": [
    { "dayName": "D1", "hotel": "酒店名称" }
  ]
}
```

**响应**：
```json
{
  "assignments": [
    {
      "name": "地点名",
      "dayIndex": 0,
      "reason": "分配理由"
    }
  ]
}
```

## 测试

运行测试脚本：
```bash
node quick-test.js
```

## 扩展方向

1. **动态调参**：根据用户偏好调整 `targetDailyMin` 和距离权重
2. **多目标优化**：引入遗传算法或模拟退火优化分配结果
3. **LLM 增强**：使用 Cursor Cloud Agent API 进一步优化分配决策
4. **实时路况**：接入 Google Directions API 获取实时交通时间
