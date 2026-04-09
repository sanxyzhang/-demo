#!/bin/bash
# 测试智能分配 API 端点

echo "启动服务器..."
node server.js &
SERVER_PID=$!

# 等待服务器启动
sleep 3

echo "发送测试请求..."
curl -X POST http://localhost:3000/api/assign-places \
  -H "Content-Type: application/json" \
  -d '{
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
}' | python3 -m json.tool

echo ""
echo "停止服务器..."
kill $SERVER_PID
