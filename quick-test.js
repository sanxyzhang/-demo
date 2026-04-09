#!/usr/bin/env node
/**
 * 快速测试智能分配逻辑（不启动服务器）
 */

// Haversine 球面距离公式
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const inputData = {
  inputPlaces: [
    {
      name: "浅草寺",
      type: "景点",
      visitDuration: 90,
      geocoded: true,
      address: "2-chōme-3-1 Asakusa, Taito City, Tokyo 111-0032",
      lat: 35.7147651,
      lng: 139.7966553
    },
    {
      name: "代代木公园",
      type: "景点",
      visitDuration: 60,
      geocoded: true,
      address: "2-1 Yoyogikamizonochō, Shibuya, Tokyo 151-0052",
      lat: 35.6700649,
      lng: 139.6949656
    },
    {
      name: "横滨红砖仓库",
      type: "景点",
      visitDuration: 90,
      geocoded: true,
      address: "1-chōme-1-1 Shinkō, Naka Ward, Yokohama, Kanagawa 231-0001",
      lat: 35.4526321,
      lng: 139.6428944
    },
    {
      name: "一兰拉面",
      type: "餐厅",
      visitDuration: 45,
      geocoded: false,
      address: "〒160-0022 Tokyo, Shinjuku City, Shinjuku, 3-chōme−34−１１ Peace Bldg., B1F",
      lat: null,
      lng: null
    }
  ],
  daySetups: [
    { dayName: "D1", hotel: "APA Hotel Asakusa Tawaramachi Ekimae" },
    { dayName: "D2", hotel: "SOTETSU HOTELS THE SPLAISIR YOKOHAMA" }
  ]
};

// 已知酒店坐标
const knownHotels = {
  "APA Hotel Asakusa Tawaramachi Ekimae": { lat: 35.7154, lng: 139.7917 },
  "SOTETSU HOTELS THE SPLAISIR YOKOHAMA": { lat: 35.4659, lng: 139.6225 }
};

const hotelGeo = inputData.daySetups.map(ds => knownHotels[ds.hotel] || null);
const dailyMinutes = [0, 0];
const targetDailyMin = 420;
const maxDailyMin = 540;
const assignments = [];

inputData.inputPlaces.forEach((place) => {
  let assignedDay = 0;
  let reason = "";

  if (!place.geocoded || !place.lat || !place.lng) {
    // 未解析坐标的地点
    if (place.type === "餐厅") {
      assignedDay = dailyMinutes[0] < dailyMinutes[1] ? 0 : 1;
      reason = "餐厅安排在晚间，选择时长较少的天";
    } else {
      assignedDay = 0;
      reason = "未解析坐标，默认分配到第一天";
    }
  } else {
    // 计算到各天酒店的距离 + 超载惩罚
    const scores = hotelGeo.map((hg, dayIdx) => {
      if (!hg) return Number.POSITIVE_INFINITY;
      const dist = haversineKm(place.lat, place.lng, hg.lat, hg.lng);
      const overload = Math.max(0, dailyMinutes[dayIdx] + place.visitDuration - targetDailyMin) * 0.05;
      return dist + overload;
    });

    let bestScore = Number.POSITIVE_INFINITY;
    for (let d = 0; d < scores.length; d += 1) {
      if (dailyMinutes[d] + place.visitDuration <= maxDailyMin || scores[d] < bestScore) {
        if (scores[d] < bestScore) {
          bestScore = scores[d];
          assignedDay = d;
        }
      }
    }

    const distKm = haversineKm(
      place.lat,
      place.lng,
      hotelGeo[assignedDay].lat,
      hotelGeo[assignedDay].lng
    ).toFixed(1);
    reason = `距离${inputData.daySetups[assignedDay].dayName}酒店${distKm}km，顺路且时长均衡`;
  }

  dailyMinutes[assignedDay] += place.visitDuration || 60;
  assignments.push({ name: place.name, dayIndex: assignedDay, reason });
});

// 特殊规则：餐厅优先安排在有景点的那天
const restaurantIndices = assignments
  .map((a, idx) => (inputData.inputPlaces[idx].type === "餐厅" ? idx : -1))
  .filter((idx) => idx >= 0);

restaurantIndices.forEach((rIdx) => {
  const dayCounts = [0, 0];
  assignments.forEach((a, idx) => {
    if (idx !== rIdx && inputData.inputPlaces[idx].type === "景点") {
      dayCounts[a.dayIndex]++;
    }
  });
  const maxCount = Math.max(...dayCounts);
  const preferredDay = dayCounts.indexOf(maxCount);
  if (preferredDay >= 0 && maxCount > 0) {
    assignments[rIdx].dayIndex = preferredDay;
    assignments[rIdx].reason = `餐厅安排在${inputData.daySetups[preferredDay].dayName}晚间用餐`;
  }
});

// 输出结果
console.log(JSON.stringify({ assignments }, null, 2));
