# 按天路线规划器（Node + Google Maps）

## 功能
- 按天维护地点列表（增删改）
- 一键规划“当天”路线（Google Directions）
- 自动优化中途点顺序（`optimizeWaypoints`）
- 展示地图路线并生成当天 Google Maps 导航链接

## 启动
1. 安装依赖（已执行过可跳过）：
   - `npm install`
2. 创建环境变量文件：
   - 复制 `.env.example` 为 `.env`
   - 填入 `GOOGLE_MAPS_API_KEY`
3. 启动：
   - `npm run dev`
4. 打开：
   - <http://localhost:3001>

> 如果你本机 `3000` 已被其他应用占用，建议继续使用 `3001`。

## 使用说明
- 每张卡片代表一天行程
- 每天至少填写 2 个地点
- 点击“规划当天路线”后，会按该天地点计算路线并显示结果

## 注意
- 当前采用浏览器端 Google Maps JS API，因此 Key 会在前端请求中使用
- 请在 Google Cloud 给 Key 配置 API 限制和应用限制，避免滥用

## 故障定位（500）
- 先查诊断接口：`curl -s http://localhost:3001/api/diagnose`
- 常见返回：
  - `dnsOk: false`：本机 DNS 无法解析 Google 域名
  - `mapsApiReachable: false` + `mapsApiError` 含 `UND_ERR_CONNECT_TIMEOUT`：网络到 Google 不通/超时
  - `keyConfigured: false`：`.env` 没有配置 Key
- 规划接口明细：`curl -s -X POST http://localhost:3001/api/plan-day -H "Content-Type: application/json" -d '{"places":["浅草寺","横滨红砖仓库","横滨港未来"],"travelMode":"transit"}'`

## 网络代理（推荐）
如果你本机访问 Google 需要代理，启动前先设置：

```bash
export HTTPS_PROXY="http://127.0.0.1:7890"
export HTTP_PROXY="http://127.0.0.1:7890"
npm run dev
```
