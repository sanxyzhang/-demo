# Route Planner Context

## 项目目标
- 根据东京/横滨/镰仓行程做按天规划。
- 每天行程以酒店为起点与终点。
- 默认先用开车模式给出可执行的"近似最优顺序"。
- 后续可扩展公共交通最优顺序能力。

## 当前核心需求（用户确认）
- 用户只需输入所有地点（景点/餐厅/商场），不需要手动分天。
- 系统智能将地点分配到合适的天，并规划当天最优路线。
- 支持填写每天酒店（起终点固定为酒店）。
- 地图显示每天规划完成的完整路线。
- 支持输入餐厅名（含连锁）并推荐插入时机。
- 计划表总览页面展示所有天的完整行程，实时更新。

## 已实现功能

### API 端点

#### `POST /api/plan-day`
- 输入：`hotel`, `places`(string[]), `travelMode`, `strictTransit`
- 输出：`orderedStops`, `stopPoints`, `legSummaries`, `polylines`
- 开车模式下：最近邻启发式排序（默认模式）
- 公共交通 ZERO_RESULTS 时自动降级为驾车估算

#### `POST /api/smart-plan-info`（新）
- 输入：`places: [{name, type}]`, `daySetups: [{dayName, hotel}]`
- 输出：`places: [{name, type, visitDuration, tip, bestTimeSlot, dayIndex}]`
- 实现原理：
  - 对每个地点和酒店调用 Google Geocoding 获取经纬度
  - 使用 **Haversine 球面距离公式** 计算地点到各天酒店的距离
  - 贪心聚类：每个地点分配到距离最近且未超载的天（每天上限 9 小时）
  - 精细时长表：常见景点内置时长（如浅草寺=90min、一兰拉面=45min）
  - 类型默认时长：景点=90min，餐厅=50min，商场=100min，其他=60min
  - bestTimeSlot 规则：餐厅→晚上，商场→下午，景点→按天奇偶分上下午

#### `POST /api/suggest-restaurant-slot`
- 使用 Google Geocoding + Places Text Search + Directions 组合推荐餐厅插入时机
- 输出：建议日期、建议在哪个景点后前往、建议到店时间、导航链接

### 前端功能

#### 编辑行程 Tab
- **行程设置区**：每天只需填写「天名 + 酒店」，不填景点
- **地点池**：统一添加所有景点/餐厅/商场（含类型标签），不需分天
- **「⚡ 智能规划所有天」按钮**：一键触发完整规划流程
- 地图实时预览每天规划结果

#### 计划表总览 Tab
- 规划时立即切换到此 Tab，预渲染 shimmer 骨架屏加载动画
- 每天规划完成后**实时**更新该卡片（无需等全部完成）
- 卡片内容：类型徽章（景点🏛/餐厅🍜/商场🛍/酒店🏨）+ 游览时长 + 路段时间 + Google Maps 链接
- 点击卡片可在地图上预览该天路线

#### 数据持久化
- 行程设置、地点池、规划结果全部写入 `localStorage`
- 刷新页面自动恢复上次数据

## 技术架构

### 后端（server.js）
- Node + Express 5 + dotenv
- 所有 Google API 调用通过 `requestJsonByCurl`（GET）/ `postJsonByCurl`（POST）封装
- 代理自动回退：proxy 不可用时（stderr 含 `127.0.0.1`）自动降级直连

### 前端（public/）
- 原生 HTML/CSS/JS + Google Maps JS SDK（geometry 库）
- Tab 路由：`switchTab(tabName)` 切换 `#tabEditor` / `#tabPlan`
- 模板复用：`<template>` 元素 + `cloneNode(true)` 动态创建行

### 依赖 API
- Google Directions API（路线规划）
- Google Geocoding API（地址→经纬度）
- Google Places API Text Search（餐厅搜索）
- Google Maps JS SDK（前端地图渲染）

## 环境配置（.env）
```
GOOGLE_MAPS_API_KEY=...
CURSOR_API_KEY=crsr_...   # Cursor Cloud Agents Key（注意：仅用于 /v0/agents，不支持 LLM 调用）
HTTP_PROXY=...            # 可选，不可用时自动直连
PORT=3001
```

## 关键技术说明

### 代理回退机制
- curl 调用失败时，检测 `stderr` 是否含 `127.0.0.1`
- 若是代理地址报错，自动以无代理模式重试
- 旧版正则 `/127\.0\.0\.1.*(Failed to connect)/` 方向有误（已修复为 `/127\.0\.0\.1/`）

### Cursor API Key 说明
- `crsr_` 前缀为 **Cloud Agents API Key**，通过 Basic Auth 访问 `api.cursor.com/v0`
- 支持操作：`/v0/me`（验证），`/v0/models`，`/v0/agents`（启动代码代理）
- **不支持** `/v1/chat/completions` 直接 LLM 调用
- 智能规划改用 Google Geocoding + 地理聚类替代 LLM 分配

### Transit 路线问题
- Google Directions `transit` 在日本场景容易返回 `ZERO_RESULTS`
- 默认策略：路线规划用 `driving`（稳定），公共交通以跳转链接辅助

## 运行方式
```bash
cd route-planner-node
npm start          # 启动服务，默认 http://localhost:3001
```

## 下一步建议
- 餐厅推荐集成到地点池（输入餐厅名自动查询推荐后加入当天）
- 支持手动拖拽调整地点所在天（覆盖智能分配结果）
- 计划表支持导出 PDF / 分享链接
- 接入支持 OpenAI-compatible 接口的 LLM（如 OpenAI API / 本地 Ollama）替代规则化分配
- 增加每天「出发时间」设置，自动推算每个景点的到达/离开时间
