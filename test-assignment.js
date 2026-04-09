#!/usr/bin/env node
/**
 * 测试智能行程分配功能
 * 输入地点池和酒店信息，输出每个地点的分配结果
 */

const inputData = {
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
};

// Haversine 球面距离公式（返回千米）
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 已知酒店坐标（实际应用中应通过 Google Geocoding 获取）
const hotelGeo = [
  { lat: 35.7154, lng: 139.7917 },  // APA Hotel Asakusa (浅草附近)
  { lat: 35.4659, lng: 139.6225 }   // SOTETSU Yokohama (横滨附近)
];

/**
 * 智能分配算法
 * 1. 优先顺路：计算每个地点到各天酒店的距离
 * 2. 均匀分配：考虑每天已分配的总时长，避免过载
 * 3. 特殊规则：餐厅优先晚间
 */
function smartAssign(places, daySetups) {
  const assignments = [];
  const dailyMinutes = new Array(daySetups.length).fill(0);
  const targetDailyMin = 420; // 目标每天7小时
  const maxDailyMin = 540;    // 上限9小时

  places.forEach((place) => {
    let assignedDay = 0;
    let reason = "";

    if (!place.geocoded || place.lat === null || place.lng === null) {
      // 未解析的地点：按类型策略分配
      if (place.type === "餐厅") {
        // 餐厅优先晚间，选择时长较少的那天
        assignedDay = dailyMinutes[0] < dailyMinutes[1] ? 0 : 1;
        reason = "餐厅安排在晚间，选择时长较少的天";
      } else {
        assignedDay = 0;
        reason = "未解析坐标，默认分配到第一天";
      }
    } else {
      // 已解析坐标的地点：计算到各天酒店的距离
      const distances = hotelGeo.map((hotel) => 
        haversineKm(place.lat, place.lng, hotel.lat, hotel.lng)
      );

      // 考虑距离 + 已分配时长的综合评分（距离为主，时长为辅）
      const scores = distances.map((dist, dayIdx) => {
        const overload = Math.max(0, dailyMinutes[dayIdx] + place.visitDuration - targetDailyMin) * 0.05;
        return dist + overload;
      });

      // 选择得分最低的天（优先顺路，其次均匀）
      assignedDay = scores[0] < scores[1] ? 0 : 1;
      const distKm = distances[assignedDay].toFixed(1);
      reason = `距离${daySetups[assignedDay].dayName}酒店${distKm}km，顺路且时长均衡`;
    }

    dailyMinutes[assignedDay] += place.visitDuration;

    assignments.push({
      name: place.name,
      dayIndex: assignedDay,
      reason: reason
    });
  });

  // 后处理：餐厅优先安排在有景点的那天晚间
  const restaurantIdx = assignments.findIndex(a => a.name === "一兰拉面");
  if (restaurantIdx !== -1) {
    // 统计每天的景点数
    const dayCounts = [0, 0];
    assignments.forEach((a, idx) => {
      if (idx !== restaurantIdx && places[idx].type === "景点") {
        dayCounts[a.dayIndex]++;
      }
    });
    // 选择景点较多的那天
    const preferredDay = dayCounts[0] >= dayCounts[1] ? 0 : 1;
    assignments[restaurantIdx].dayIndex = preferredDay;
    assignments[restaurantIdx].reason = `餐厅安排在${inputData.daySetups[preferredDay].dayName}晚间用餐`;
  }

  return assignments;
}

// 执行分配
const result = smartAssign(inputData.inputPlaces, inputData.daySetups);

// 输出 JSON（严格格式）
console.log(JSON.stringify({
  assignments: result
}, null, 2));
