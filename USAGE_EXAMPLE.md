# 智能行程分配使用示例

## 快速开始

### 方法一：使用测试脚本（推荐）

直接运行独立测试脚本，无需启动服务器：

```bash
node quick-test.js
```

**输出**：
```json
{
  "assignments": [
    {
      "name": "浅草寺",
      "dayIndex": 0,
      "reason": "距离D1酒店0.5km，顺路且时长均衡"
    },
    {
      "name": "代代木公园",
      "dayIndex": 0,
      "reason": "距离D1酒店10.1km，顺路且时长均衡"
    },
    {
      "name": "横滨红砖仓库",
      "dayIndex": 1,
      "reason": "距离D2酒店2.4km，顺路且时长均衡"
    },
    {
      "name": "一兰拉面",
      "dayIndex": 0,
      "reason": "餐厅安排在D1晚间用餐"
    }
  ]
}
```

### 方法二：使用 API 端点

1. 启动服务器：
```bash
npm start
```

2. 发送 POST 请求：
```bash
curl -X POST http://localhost:3000/api/assign-places \
  -H "Content-Type: application/json" \
  -d @- << 'EOF'
{
  "inputPlaces": [
    {
      "name": "浅草寺",
      "type": "景点",
      "visitDuration": 90,
      "geocoded": true,
      "address": "2-chōme-3-1 Asakusa, Taito City, Tokyo 111-0032",
      "lat": 35.7147651,
      "lng": 139.7966553
    },
    {
      "name": "代代木公园",
      "type": "景点",
      "visitDuration": 60,
      "geocoded": true,
      "address": "2-1 Yoyogikamizonochō, Shibuya, Tokyo 151-0052",
      "lat": 35.6700649,
      "lng": 139.6949656
    },
    {
      "name": "横滨红砖仓库",
      "type": "景点",
      "visitDuration": 90,
      "geocoded": true,
      "address": "1-chōme-1-1 Shinkō, Naka Ward, Yokohama, Kanagawa 231-0001",
      "lat": 35.4526321,
      "lng": 139.6428944
    },
    {
      "name": "一兰拉面",
      "type": "餐厅",
      "visitDuration": 45,
      "geocoded": false,
      "address": "〒160-0022 Tokyo, Shinjuku City, Shinjuku, 3-chōme−34−１１ Peace Bldg., B1F",
      "lat": null,
      "lng": null
    }
  ],
  "daySetups": [
    {
      "dayName": "D1",
      "hotel": "APA Hotel Asakusa Tawaramachi Ekimae"
    },
    {
      "dayName": "D2",
      "hotel": "SOTETSU HOTELS THE SPLAISIR YOKOHAMA"
    }
  ]
}
EOF
```

## 输入数据格式

### `inputPlaces` 数组

每个地点包含以下字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 地点名称 |
| `type` | string | ✅ | 类型：`景点`、`餐厅`、`商场`、`其他` |
| `visitDuration` | number | ✅ | 游览时长（分钟） |
| `geocoded` | boolean | ✅ | 是否已解析坐标 |
| `address` | string | ❌ | 地址（可选） |
| `lat` | number/null | ✅ | 纬度（未解析时为 `null`） |
| `lng` | number/null | ✅ | 经度（未解析时为 `null`） |

### `daySetups` 数组

每天包含以下字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `dayName` | string | ✅ | 天名称（如 `D1`、`第一天` 等） |
| `hotel` | string | ✅ | 酒店名称（作为当天起终点） |

## 输出数据格式

### `assignments` 数组

每个分配结果包含：

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 地点名称 |
| `dayIndex` | number | 分配到的天索引（0-based） |
| `reason` | string | 分配理由 |

## 分配逻辑说明

### 1. 已解析坐标的地点
- 计算到各天酒店的 **Haversine 球面距离**
- 评分公式：`score = 距离 + 超载惩罚`
- 选择评分最低的天（优先距离近，其次时长均衡）

### 2. 未解析坐标的地点
- **餐厅**：分配到时长较少的那天
- **其他**：默认分配到第一天

### 3. 特殊优化
- 所有餐厅在初步分配后，重新分配到**景点数量最多**的那天
- 理由：餐厅通常作为晚餐，应在有景点的当天安排

## 实际案例分析

### 输入分析
- **D1 酒店**：APA Hotel Asakusa（浅草地区，东京东部）
- **D2 酒店**：SOTETSU Yokohama（横滨地区，东京西南）

### 距离计算
| 地点 | 到 D1 酒店距离 | 到 D2 酒店距离 | 分配结果 |
|------|----------------|----------------|----------|
| 浅草寺 | **0.5 km** | 32.5 km | ✅ D1（顺路） |
| 代代木公园 | **10.1 km** | 31.8 km | ✅ D1（距离优势明显） |
| 横滨红砖仓库 | 32.1 km | **2.4 km** | ✅ D2（横滨景点） |
| 一兰拉面 | 未解析 | 未解析 | ✅ D1（餐厅规则：D1 有 2 个景点） |

### 时长统计
- **D1**: 浅草寺(90min) + 代代木公园(60min) + 一兰拉面(45min) = **195 分钟**
- **D2**: 横滨红砖仓库(90min) = **90 分钟**

### 分配理由
1. **浅草寺**：距离 D1 酒店仅 0.5km，极度顺路 ✅
2. **代代木公园**：虽然距离 D1 酒店 10.1km，但远好于 31.8km 的 D2 ✅
3. **横滨红砖仓库**：典型的横滨景点，距离 D2 酒店仅 2.4km ✅
4. **一兰拉面**：D1 有 2 个景点，D2 只有 1 个，餐厅安排在 D1 晚间 ✅

## 自定义使用

### 修改测试数据

编辑 `quick-test.js` 中的 `inputData` 对象：

```javascript
const inputData = {
  inputPlaces: [
    // 添加你的地点...
  ],
  daySetups: [
    // 添加你的天数设置...
  ]
};
```

### 集成到你的应用

```javascript
// 引入 Haversine 函数
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * 
    Math.cos((lat2 * Math.PI) / 180) * 
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 调用分配算法
const assignments = assignPlaces(inputPlaces, daySetups, hotelGeo);
```

## 常见问题

### Q: 为什么餐厅分配到 D1 而不是 D2？
**A**: 餐厅优先规则是"分配到景点数量最多的那天"，因为 D1 有 2 个景点（浅草寺 + 代代木公园），而 D2 只有 1 个景点（横滨红砖仓库），所以一兰拉面被分配到 D1 作为晚餐。

### Q: 如果我想改变分配策略怎么办？
**A**: 可以修改 `quick-test.js` 或 `server.js` 中的以下参数：
- `targetDailyMin`：目标每天时长（默认 420 分钟 = 7 小时）
- `maxDailyMin`：每天上限时长（默认 540 分钟 = 9 小时）
- 超载惩罚系数：默认 `0.05`（越大越重视时长均衡）

### Q: 如何处理 3 天或更多天的行程？
**A**: 只需在 `daySetups` 数组中添加更多天即可，算法会自动适配：

```json
{
  "daySetups": [
    { "dayName": "D1", "hotel": "Tokyo Hotel" },
    { "dayName": "D2", "hotel": "Yokohama Hotel" },
    { "dayName": "D3", "hotel": "Kamakura Hotel" }
  ]
}
```

## 扩展阅读

- 详细算法说明：[ASSIGNMENT_ALGORITHM.md](./ASSIGNMENT_ALGORITHM.md)
- 项目文档：[context.md](./context.md)
- 主 README：[README.md](./README.md)
