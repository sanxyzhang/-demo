const express = require("express");
const path = require("path");
const dotenv = require("dotenv");
const dns = require("dns").promises;
const { execFile } = require("child_process");

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY || "";
const cursorApiKey = process.env.CURSOR_API_KEY || "";
const proxyUrl =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy ||
  process.env.ALL_PROXY ||
  process.env.all_proxy ||
  "";

const CURSOR_AGENT_API_BASE = "https://api.cursor.com/v0";
const cursorSourceRepository = process.env.CURSOR_SOURCE_REPOSITORY || "";
const DEFAULT_SMART_PLAN_PROMPT =
  "请把地点池分配到每天：优先顺路（地理上相近、减少折返），并保证每天行程尽量均匀（总时长接近）。" +
  "优先把餐厅安排在当天晚间、商场安排在下午。输出只返回 JSON，不要解释。";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/config.js", (req, res) => {
  res.type("application/javascript");
  res.send(`window.APP_CONFIG = { GOOGLE_MAPS_API_KEY: "${mapsApiKey}" };`);
});

function requestJsonByCurl(url, timeoutSec = 12) {
  return new Promise((resolve, reject) => {
    const runCurl = (withProxy) => {
      const args = ["-sS", "--max-time", String(timeoutSec), url];
      if (withProxy && proxyUrl) {
        args.unshift(proxyUrl);
        args.unshift("-x");
      }
      execFile("curl", args, { encoding: "utf8" }, (error, stdout, stderr) => {
        if (error) {
          const msg = stderr || error.message || "curl 请求失败";
          const proxyDown = withProxy && /127\.0\.0\.1/.test(msg);
          if (proxyDown) {
            runCurl(false);
            return;
          }
          const err = new Error(msg);
          err.code = error.code || "CURL_FAILED";
          reject(err);
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error("Google 接口返回了非 JSON 数据"));
        }
      });
    };
    runCurl(Boolean(proxyUrl));
  });
}

function requestJsonByCurlWithOptions({
  url,
  method = "GET",
  body = null,
  extraHeaders = {},
  basicAuthUser = "",
  timeoutSec = 30,
}) {
  return new Promise((resolve, reject) => {
    const runCurl = (withProxy) => {
      const args = ["-sS", "--max-time", String(timeoutSec), "-X", method];
      if (basicAuthUser) {
        args.push("-u", `${basicAuthUser}:`);
      }
      Object.entries(extraHeaders).forEach(([k, v]) => {
        args.push("-H", `${k}: ${v}`);
      });
      if (body !== null && body !== undefined) {
        args.push("-H", "Content-Type: application/json", "-d", JSON.stringify(body));
      }
      args.push(url);
      if (withProxy && proxyUrl) {
        args.unshift(proxyUrl);
        args.unshift("-x");
      }
      execFile("curl", args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          const msg = stderr || error.message || "curl 请求失败";
          const proxyDown = withProxy && /127\.0\.0\.1/.test(msg);
          if (proxyDown) { runCurl(false); return; }
          const err = new Error(msg);
          err.code = error.code || "CURL_FAILED";
          reject(err);
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(`接口返回了非 JSON 数据: ${String(stdout).slice(0, 300)}`));
        }
      });
    };
    runCurl(Boolean(proxyUrl));
  });
}

// POST request helper (for LLM APIs etc.)
function postJsonByCurl(url, body, extraHeaders = {}, timeoutSec = 30) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const runCurl = (withProxy) => {
      const headerArgs = Object.entries(extraHeaders).flatMap(([k, v]) => ["-H", `${k}: ${v}`]);
      const args = [
        "-sS",
        "--max-time", String(timeoutSec),
        "-X", "POST",
        "-H", "Content-Type: application/json",
        ...headerArgs,
        "-d", bodyStr,
        url,
      ];
      if (withProxy && proxyUrl) {
        args.unshift(proxyUrl);
        args.unshift("-x");
      }
      execFile("curl", args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          const msg = stderr || error.message || "curl POST 失败";
          // 代理不可用时（127.0.0.1 出现在报错中）自动降级直连
          const proxyDown = withProxy && /127\.0\.0\.1/.test(msg);
          if (proxyDown) { runCurl(false); return; }
          const err = new Error(msg);
          err.code = error.code || "CURL_FAILED";
          reject(err);
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error("接口返回了非 JSON 数据: " + stdout.slice(0, 300)));
        }
      });
    };
    runCurl(Boolean(proxyUrl));
  });
}

async function geocodePlace(input, key) {
  const params = new URLSearchParams({
    address: input,
    key,
    language: "zh-CN",
    region: "jp",
  });
  const url = `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;
  const data = await requestJsonByCurl(url, 12);
  if (data.status !== "OK" || !data.results?.[0]) {
    return null;
  }
  const r = data.results[0];
  return {
    placeId: r.place_id,
    formattedAddress: r.formatted_address || input,
    lat: r.geometry?.location?.lat,
    lng: r.geometry?.location?.lng,
  };
}

async function searchPlaceProfile(input, key, nearLat, nearLng) {
  const params = new URLSearchParams({
    query: input,
    language: "zh-CN",
    region: "jp",
    key,
  });
  if (typeof nearLat === "number" && typeof nearLng === "number") {
    params.set("location", `${nearLat},${nearLng}`);
    params.set("radius", "6000");
  }
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`;
  const data = await requestJsonByCurl(url, 12);
  if (data.status !== "OK" || !data.results?.[0]) return null;
  const r = data.results[0];
  return {
    name: r.name || input,
    placeId: r.place_id || "",
    address: r.formatted_address || "",
    rating: r.rating || null,
    userRatingsTotal: r.user_ratings_total || null,
    types: Array.isArray(r.types) ? r.types : [],
    openNow: r.opening_hours?.open_now ?? null,
    lat: r.geometry?.location?.lat,
    lng: r.geometry?.location?.lng,
  };
}

/**
 * POST /api/smart-plan-info
 * 基于 Google Geocoding + 地理聚类算法，为地点池自动生成：
 *   - visitDuration: 建议游览时长（分钟，按类型+名称估算）
 *   - description:   简介
 *   - tip:           游览贴士
 *   - bestTimeSlot:  建议时段
 *   - dayIndex:      建议安排在第几天（0-based），依据距各天酒店的地理距离聚合
 *
 * Request:  { places: [{name, type}], daySetups: [{dayName, hotel}] }
 * Response: { places: [{name, type, visitDuration, description, tip, bestTimeSlot, dayIndex}] }
 */

// 各类地点的默认游览时长（分钟）
const TYPE_DURATION = { 景点: 90, 餐厅: 50, 商场: 100, 其他: 60 };

// 常见景点精细时长（日本旅游高频地点）
const PLACE_DURATION = {
  浅草寺: 90, 代代木公园: 60, 下北泽: 120, 合羽桥道具街: 90,
  隅田川: 60, 横滨红砖仓库: 90, 横滨港未来: 120, 长谷寺: 90,
  高德院: 60, 镰仓高校前站: 45, 七里滨: 60, 小町通: 90,
  一兰拉面: 45, 横滨站周边: 120, 羽田机场: 30, 成田机场: 30,
  秋叶原: 120, 新宿御苑: 90, 上野公园: 90, 涩谷: 120,
  新宿: 120, 银座: 120, 池袋: 100, 原宿: 90, 表参道: 90,
};

const GOOGLE_TYPE_DURATION = {
  tourist_attraction: 100,
  museum: 120,
  park: 80,
  shopping_mall: 120,
  department_store: 90,
  restaurant: 60,
  cafe: 45,
  temple: 90,
  shrine: 90,
};

// 各类型默认贴士
const TYPE_TIP = {
  景点: "建议提前查好开放时间",
  餐厅: "热门店铺建议提前排队",
  商场: "营业至晚间，下午较空",
  其他: "注意当地交通",
};

// Haversine 球面距离（返回千米）
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function extractFirstJsonObject(text) {
  if (!text) return null;
  let trimmed = String(text).trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)```/im.exec(trimmed);
  if (fence) trimmed = fence[1].trim();
  const direct = safeJsonParse(trimmed);
  if (direct && typeof direct === "object") return direct;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const sliced = trimmed.slice(start, end + 1);
    return safeJsonParse(sliced);
  }
  return null;
}

function assignPlacesByHeuristic(places, daySetups, placeGeo, placeProfiles, options = {}) {
  const targetDailyMin = Number(options.targetDailyMin || 420);
  const maxDailyMin = Number(options.maxDailyMin || 540);
  const hotelGeo = daySetups.map(() => null);

  return (async () => {
    for (let i = 0; i < daySetups.length; i += 1) {
      if (!daySetups[i].hotel) continue;
      hotelGeo[i] = await geocodePlace(daySetups[i].hotel, mapsApiKey);
    }

    const dailyMinutes = new Array(daySetups.length).fill(0);
    const assignments = places.map((p, i) => {
      const inferredTypeDuration = (placeProfiles[i]?.types || [])
        .map((t) => GOOGLE_TYPE_DURATION[t])
        .find((v) => typeof v === "number");
      const dur = PLACE_DURATION[p.name] ?? inferredTypeDuration ?? TYPE_DURATION[p.type] ?? 60;

      if (!placeGeo[i]) {
        const idx = i % daySetups.length;
        dailyMinutes[idx] += dur;
        return buildPlaceResult(p, dur, idx, daySetups.length, placeProfiles[i], false);
      }

      const { lat, lng } = placeGeo[i];
      const scores = hotelGeo.map((hg, dayIdx) => {
        if (!hg) return Number.POSITIVE_INFINITY;
        const dist = haversineKm(lat, lng, hg.lat, hg.lng);
        const overload = Math.max(0, dailyMinutes[dayIdx] + dur - targetDailyMin) * 0.05;
        return dist + overload;
      });

      let best = 0;
      let bestScore = Number.POSITIVE_INFINITY;
      for (let d = 0; d < scores.length; d += 1) {
        if (dailyMinutes[d] + dur <= maxDailyMin || scores[d] < bestScore) {
          if (scores[d] < bestScore) { bestScore = scores[d]; best = d; }
        }
      }

      dailyMinutes[best] += dur;
      return buildPlaceResult(p, dur, best, daySetups.length, placeProfiles[i], true);
    });

    // 避免出现“当天无分配地点”：当地点数 >= 天数时，强制每一天至少 1 个
    if (assignments.length >= daySetups.length) {
      const buckets = daySetups.map(() => []);
      assignments.forEach((it, idx) => buckets[it.dayIndex].push({ it, idx }));
      for (let day = 0; day < buckets.length; day += 1) {
        if (buckets[day].length > 0) continue;
        let donor = -1;
        for (let d = 0; d < buckets.length; d += 1) {
          if (buckets[d].length > 1 && (donor < 0 || buckets[d].length > buckets[donor].length)) donor = d;
        }
        if (donor >= 0) {
          const moved = buckets[donor].pop();
          assignments[moved.idx] = { ...assignments[moved.idx], dayIndex: day };
          buckets[day].push({ it: assignments[moved.idx], idx: moved.idx });
        }
      }
    }
    return assignments;
  })();
}

function extractCursorTextContent(data) {
  const msg = data?.choices?.[0]?.message?.content;
  if (typeof msg === "string") return msg;
  if (Array.isArray(msg)) {
    const t = msg.map((x) => x?.text || x?.content || "").join("\n").trim();
    if (t) return t;
  }
  return "";
}

function ensureBalancedDays(assignments, daySetups) {
  const dayCount = daySetups.length;
  const out = assignments.map((x) => ({ ...x }));
  const buckets = daySetups.map(() => []);
  out.forEach((p, idx) => {
    const d = Math.max(0, Math.min(dayCount - 1, Number(p.dayIndex || 0)));
    p.dayIndex = d;
    buckets[d].push(idx);
  });

  // 先保证“每天至少一个已解析地点”
  const geocodedCount = out.filter((p) => p.geocoded !== false).length;
  if (geocodedCount >= dayCount) {
    for (let day = 0; day < dayCount; day += 1) {
      const hasGeocoded = buckets[day].some((idx) => out[idx].geocoded !== false);
      if (hasGeocoded) continue;
      let donor = -1;
      for (let d = 0; d < dayCount; d += 1) {
        const geocodedInDonor = buckets[d].filter((idx) => out[idx].geocoded !== false);
        if (geocodedInDonor.length > 1) { donor = d; break; }
      }
      if (donor >= 0) {
        const moveIdx = buckets[donor].find((idx) => out[idx].geocoded !== false);
        buckets[donor] = buckets[donor].filter((idx) => idx !== moveIdx);
        buckets[day].push(moveIdx);
        out[moveIdx].dayIndex = day;
      }
    }
  }

  // 再保证“每天至少一个地点”
  if (out.length >= dayCount) {
    for (let day = 0; day < dayCount; day += 1) {
      if (buckets[day].length > 0) continue;
      let donor = -1;
      for (let d = 0; d < dayCount; d += 1) {
        if (buckets[d].length > 1 && (donor < 0 || buckets[d].length > buckets[donor].length)) donor = d;
      }
      if (donor >= 0) {
        const moveIdx = buckets[donor].pop();
        buckets[day].push(moveIdx);
        out[moveIdx].dayIndex = day;
      }
    }
  }

  return out;
}

async function assignPlacesByCursor({
  places,
  daySetups,
  enrichedPlaces,
  userInstruction,
}) {
  if (!cursorApiKey) return { assigned: null, reason: "cursor_key_missing" };

  const systemPrompt =
    "你是日本自由行行程规划助手。你需要把地点分配到每天，输出严格 JSON。";
  const mergedInstruction = [DEFAULT_SMART_PLAN_PROMPT, userInstruction || ""].filter(Boolean).join("\n");
  const schemaHint = {
    places: places.map((p) => p.name),
    days: daySetups.map((d, i) => ({ dayIndex: i, dayName: d.dayName, hotel: d.hotel })),
    output: {
      assignments: [{ name: "地点名", dayIndex: 0, reason: "简短理由" }],
    },
  };

  const promptText = [
    systemPrompt,
    mergedInstruction,
    "请只返回 JSON，格式如下：",
    JSON.stringify(schemaHint.output, null, 2),
    "输入数据：",
    JSON.stringify({
      inputPlaces: enrichedPlaces.map((p) => ({
        name: p.name,
        type: p.type,
        visitDuration: p.visitDuration,
        geocoded: p.geocoded,
        address: p.description || "",
        lat: p.__lat ?? null,
        lng: p.__lng ?? null,
      })),
      daySetups,
    }, null, 2),
  ].join("\n\n");

  const createBody = {
    prompt: { text: promptText },
  };
  if (cursorSourceRepository) {
    createBody.source = { repository: cursorSourceRepository };
  }

  const createData = await requestJsonByCurlWithOptions({
    url: `${CURSOR_AGENT_API_BASE}/agents`,
    method: "POST",
    body: createBody,
    basicAuthUser: cursorApiKey,
    timeoutSec: 40,
  });
  if (createData?.error) {
    return { assigned: null, reason: `cursor_api_error:${createData.error || createData.message || "unknown"}` };
  }

  const agentId = createData?.id || createData?.agent?.id;
  if (!agentId) {
    return { assigned: null, reason: "cursor_api_error:no_agent_id" };
  }

  let finalData = null;
  for (let i = 0; i < 18; i += 1) {
    // 最高约 36s 轮询
    // eslint-disable-next-line no-await-in-loop
    finalData = await requestJsonByCurlWithOptions({
      url: `${CURSOR_AGENT_API_BASE}/agents/${encodeURIComponent(agentId)}`,
      method: "GET",
      basicAuthUser: cursorApiKey,
      timeoutSec: 20,
    });
    const status = String(finalData?.status || "").toLowerCase();
    if (["completed", "done", "succeeded", "failed", "cancelled", "canceled", "error"].includes(status)) break;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 2000));
  }

  const status = String(finalData?.status || "").toLowerCase();
  if (["failed", "cancelled", "canceled", "error"].includes(status)) {
    return { assigned: null, reason: `cursor_agent_${status}:${finalData?.error || finalData?.message || "unknown"}` };
  }

  const content =
    finalData?.result?.output_text ||
    finalData?.output_text ||
    finalData?.output ||
    finalData?.response?.output_text ||
    finalData?.response?.text ||
    finalData?.message?.content ||
    extractCursorTextContent(finalData) ||
    JSON.stringify(finalData);
  const parsed = extractFirstJsonObject(content);
  if (!parsed?.assignments || !Array.isArray(parsed.assignments)) {
    return { assigned: null, reason: `cursor_parse_failed:${String(content).slice(0, 120)}` };
  }

  const dayCount = daySetups.length;
  const byName = Object.fromEntries(
    enrichedPlaces.map((p) => [p.name, p]),
  );
  const assigned = enrichedPlaces.map((p) => ({ ...p }));
  parsed.assignments.forEach((a) => {
    const name = String(a?.name || "").trim();
    if (!name || !byName[name]) return;
    const raw = Number(a?.dayIndex);
    const idx = Number.isFinite(raw) ? Math.max(0, Math.min(dayCount - 1, raw)) : byName[name].dayIndex;
    const target = assigned.find((x) => x.name === name);
    if (target) target.dayIndex = idx;
  });
  return { assigned, reason: "ok" };
}

function applyRuleBasedAdjustment(currentPlaces, daySetups, instruction) {
  const adjusted = currentPlaces.map((p) => ({ ...p }));
  const dayCount = daySetups.length;
  const dayMatch = instruction.match(/第\s*(\d+)\s*天/);
  const targetDay = dayMatch ? Math.max(0, Math.min(dayCount - 1, Number(dayMatch[1]) - 1)) : null;

  if (targetDay !== null) {
    adjusted.forEach((p) => {
      if (instruction.includes(p.name)) {
        p.dayIndex = targetDay;
      }
    });
  }

  if (/均匀|平衡|平均/.test(instruction)) {
    const buckets = daySetups.map(() => []);
    adjusted.forEach((p, idx) => {
      const d = Math.max(0, Math.min(dayCount - 1, Number(p.dayIndex || 0)));
      p.dayIndex = d;
      buckets[d].push(idx);
    });
    const total = adjusted.length;
    const target = Math.ceil(total / dayCount);
    for (let i = 0; i < dayCount; i += 1) {
      while (buckets[i].length > target + 1) {
        let empty = buckets.findIndex((b) => b.length === 0);
        if (empty < 0) empty = buckets.findIndex((b) => b.length < target);
        if (empty < 0) break;
        const idx = buckets[i].pop();
        adjusted[idx].dayIndex = empty;
        buckets[empty].push(idx);
      }
    }
  }
  return adjusted;
}

app.post("/api/smart-plan-info", async (req, res) => {
  try {
    if (!mapsApiKey) {
      res.status(500).json({ error: "服务端未配置 GOOGLE_MAPS_API_KEY" });
      return;
    }

    const places = Array.isArray(req.body?.places) ? req.body.places : [];
    const daySetups = Array.isArray(req.body?.daySetups) ? req.body.daySetups : [];
    const userInstruction = String(req.body?.instruction || "").trim();

    if (places.length === 0) {
      res.status(400).json({ error: "请提供至少一个地点" });
      return;
    }
    if (daySetups.length === 0) {
      res.status(400).json({ error: "请先配置行程天数和酒店" });
      return;
    }

    // ── Step 1: Geocode + Place profile 所有地点 ──
    const placeGeo = [];
    const placeProfiles = [];
    for (const p of places) {
      const g = await geocodePlace(p.name, mapsApiKey);
      placeGeo.push(g); // may be null if geocode fails
      const profile = await searchPlaceProfile(p.name, mapsApiKey, g?.lat, g?.lng);
      placeProfiles.push(profile);
    }

    const baseEnriched = places.map((p, i) => {
      const inferredTypeDuration = (placeProfiles[i]?.types || [])
        .map((t) => GOOGLE_TYPE_DURATION[t])
        .find((v) => typeof v === "number");
      const dur = PLACE_DURATION[p.name] ?? inferredTypeDuration ?? TYPE_DURATION[p.type] ?? 60;
      const initialDay = i % daySetups.length;
      const item = buildPlaceResult(p, dur, initialDay, daySetups.length, placeProfiles[i], Boolean(placeGeo[i]));
      return { ...item, __lat: placeGeo[i]?.lat ?? null, __lng: placeGeo[i]?.lng ?? null };
    });

    const heuristicAssigned = await assignPlacesByHeuristic(
      places,
      daySetups,
      placeGeo,
      placeProfiles,
      { targetDailyMin: 420, maxDailyMin: 540 },
    );
    const heuristicByName = Object.fromEntries(heuristicAssigned.map((p) => [p.name, p.dayIndex]));
    const enrichedWithHeuristic = baseEnriched.map((p) => ({
      ...p,
      dayIndex: heuristicByName[p.name] ?? p.dayIndex,
    }));

    let finalAssigned = ensureBalancedDays(enrichedWithHeuristic, daySetups);
    let plannerSource = "heuristic";
    let cursorReason = "not_attempted";
    if (cursorApiKey) {
      try {
        const cursorResult = await assignPlacesByCursor({
          places,
          daySetups,
          enrichedPlaces: enrichedWithHeuristic,
          userInstruction,
        });
        cursorReason = cursorResult?.reason || "unknown";
        if (cursorResult?.assigned?.length) {
          finalAssigned = ensureBalancedDays(cursorResult.assigned, daySetups);
          plannerSource = "cursor";
        }
      } catch (err) {
        plannerSource = "heuristic_fallback";
        cursorReason = `cursor_exception:${err.message || "unknown"}`;
      }
    }

    const placesOut = finalAssigned.map(({ __lat, __lng, ...rest }) => rest);
    res.json({
      places: placesOut,
      plannerSource,
      usedInstruction: userInstruction || DEFAULT_SMART_PLAN_PROMPT,
      defaultPrompt: DEFAULT_SMART_PLAN_PROMPT,
      cursorDebug: cursorReason,
      cursorKeyConfigured: Boolean(cursorApiKey),
    });
  } catch (err) {
    res.status(500).json({ error: "智能规划信息获取失败", details: err.message || "未知异常" });
  }
});

app.post("/api/adjust-plan", async (req, res) => {
  try {
    const daySetups = Array.isArray(req.body?.daySetups) ? req.body.daySetups : [];
    const currentPlaces = Array.isArray(req.body?.currentPlaces) ? req.body.currentPlaces : [];
    const instruction = String(req.body?.instruction || "").trim();
    if (!instruction) {
      res.status(400).json({ error: "请提供调节指令" });
      return;
    }
    if (!daySetups.length || !currentPlaces.length) {
      res.status(400).json({ error: "缺少当前行程信息" });
      return;
    }

    let adjusted = null;
    let plannerSource = "rule-adjust";
    let cursorReason = "not_attempted";
    if (cursorApiKey) {
      try {
        const cursorResult = await assignPlacesByCursor({
          places: currentPlaces.map((p) => ({ name: p.name, type: p.type })),
          daySetups,
          enrichedPlaces: currentPlaces,
          userInstruction: instruction,
        });
        cursorReason = cursorResult?.reason || "unknown";
        adjusted = cursorResult?.assigned || null;
        if (adjusted?.length) plannerSource = "cursor-adjust";
      } catch (err) {
        cursorReason = `cursor_exception:${err.message || "unknown"}`;
        adjusted = null;
      }
    }
    if (!adjusted?.length) {
      adjusted = applyRuleBasedAdjustment(currentPlaces, daySetups, instruction);
    }

    res.json({
      places: ensureBalancedDays(adjusted, daySetups).map(({ __lat, __lng, ...rest }) => rest),
      plannerSource,
      usedInstruction: instruction,
      cursorDebug: cursorReason,
      cursorKeyConfigured: Boolean(cursorApiKey),
    });
  } catch (err) {
    res.status(500).json({ error: "二次调节失败", details: err.message || "未知异常" });
  }
});

/**
 * POST /api/place-insight
 * Request: { places: [{ name: string, type?: "景点"|"餐厅"|"商场"|"其他" }] }
 * Response: {
 *   places: [{
 *     name, normalizedName, type, visitDuration, bestTimeSlot, tip,
 *     location: { lat, lng, address, placeId },
 *     placeProfile: { rating, userRatingsTotal, openNow, types }
 *   }]
 * }
 */
app.post("/api/place-insight", async (req, res) => {
  try {
    if (!mapsApiKey) {
      res.status(500).json({ error: "服务端未配置 GOOGLE_MAPS_API_KEY" });
      return;
    }
    const places = Array.isArray(req.body?.places) ? req.body.places : [];
    if (!places.length) {
      res.status(400).json({ error: "请提供至少一个地点" });
      return;
    }

    const output = [];
    for (const p of places) {
      const name = String(p?.name || "").trim();
      const type = String(p?.type || "景点");
      if (!name) continue;

      const geo = await geocodePlace(name, mapsApiKey);
      const profile = await searchPlaceProfile(name, mapsApiKey, geo?.lat, geo?.lng);
      const inferredTypeDuration = (profile?.types || [])
        .map((t) => GOOGLE_TYPE_DURATION[t])
        .find((v) => typeof v === "number");
      const visitDuration = PLACE_DURATION[name] ?? inferredTypeDuration ?? TYPE_DURATION[type] ?? 60;

      output.push({
        name,
        normalizedName: profile?.name || name,
        type,
        visitDuration,
        bestTimeSlot: type === "餐厅" ? "晚上" : type === "商场" ? "下午" : "上午",
        tip: TYPE_TIP[type] || "",
        location: {
          lat: geo?.lat ?? null,
          lng: geo?.lng ?? null,
          address: geo?.formattedAddress || profile?.address || "",
          placeId: geo?.placeId || profile?.placeId || "",
        },
        placeProfile: {
          rating: profile?.rating ?? null,
          userRatingsTotal: profile?.userRatingsTotal ?? null,
          openNow: profile?.openNow ?? null,
          types: profile?.types || [],
        },
      });
    }
    res.json({ places: output });
  } catch (err) {
    res.status(500).json({ error: "景点详情查询失败", details: err.message || "未知异常" });
  }
});

function buildPlaceResult(p, dur, dayIndex, totalDays, profile, geocoded) {
  // bestTimeSlot 规则：餐厅=晚上，商场=下午，景点=按 dayIndex 奇偶分上下午
  let slot = "全天";
  if (p.type === "餐厅") slot = "晚上";
  else if (p.type === "商场") slot = "下午";
  else if (p.type === "景点") slot = dayIndex % 2 === 0 ? "上午" : "下午";

  return {
    name: p.name,
    type: p.type || "景点",
    visitDuration: dur,
    description: profile?.address || "",
    tip: TYPE_TIP[p.type] || "",
    bestTimeSlot: slot,
    dayIndex: Math.min(dayIndex, totalDays - 1),
    geocoded: Boolean(geocoded),
    placeProfile: {
      rating: profile?.rating ?? null,
      userRatingsTotal: profile?.userRatingsTotal ?? null,
      openNow: profile?.openNow ?? null,
      types: profile?.types || [],
    },
  };
}

app.get("/api/diagnose", async (req, res) => {
  const result = {
    keyConfigured: Boolean(mapsApiKey),
    keyPrefix: mapsApiKey ? mapsApiKey.slice(0, 8) : "",
    dnsOk: false,
    dnsError: "",
    mapsApiReachable: false,
    mapsApiStatus: "",
    mapsApiError: "",
  };

  try {
    await dns.lookup("maps.googleapis.com");
    result.dnsOk = true;
  } catch (err) {
    result.dnsError = err.message || "DNS 查询失败";
  }

  if (result.dnsOk && mapsApiKey) {
    try {
      const healthParams = new URLSearchParams({
        origin: "Tokyo",
        destination: "Yokohama",
        mode: "driving",
        language: "zh-CN",
        region: "jp",
        key: mapsApiKey,
      });
      const healthUrl = `https://maps.googleapis.com/maps/api/directions/json?${healthParams.toString()}`;
      const data = await requestJsonByCurl(healthUrl, 8);
      result.mapsApiReachable = true;
      result.mapsApiStatus = data?.status || "UNKNOWN";
      if (data?.error_message) result.mapsApiError = data.error_message;
    } catch (err) {
      result.mapsApiError = err?.code || err.message || "访问失败";
    }
  } else if (result.dnsOk && !mapsApiKey) {
    result.mapsApiError = "未配置 GOOGLE_MAPS_API_KEY，跳过连通性探测";
  }

  res.json(result);
});

app.post("/api/plan-day", async (req, res) => {
  try {
    if (!mapsApiKey) {
      res.status(500).json({ error: "服务端未配置 GOOGLE_MAPS_API_KEY" });
      return;
    }

    const places = Array.isArray(req.body?.places)
      ? req.body.places.map((v) => String(v || "").trim()).filter(Boolean)
      : [];
    const travelMode = String(req.body?.travelMode || "transit").toLowerCase();
    const hotel = String(req.body?.hotel || "").trim();
    const strictTransit = Boolean(req.body?.strictTransit ?? true);

    if (!hotel) {
      res.status(400).json({ error: "请填写当天酒店（作为起终点）" });
      return;
    }
    if (places.length < 1) {
      res.status(400).json({ error: "至少需要 1 个当天地点" });
      return;
    }

    const modeMap = {
      walking: "walking",
      bicycling: "bicycling",
      driving: "driving",
      transit: "transit",
    };
    const mode = modeMap[travelMode] || "transit";
    let orderedPlaces = [...places];
    // 驾车模式：按直线距离做最近邻排序（避免 O(n²) Directions 调用）
    if (mode === "driving" && orderedPlaces.length > 1) {
      const geoByName = {};
      for (const name of orderedPlaces) {
        const g = await geocodePlace(name, mapsApiKey);
        if (g?.lat != null && g?.lng != null) geoByName[name] = g;
      }
      let currentGeo = await geocodePlace(hotel, mapsApiKey);
      const remaining = [...orderedPlaces];
      const reordered = [];
      while (remaining.length > 0) {
        let bestIdx = 0;
        let bestDist = Number.POSITIVE_INFINITY;
        for (let i = 0; i < remaining.length; i += 1) {
          const cand = remaining[i];
          const g = geoByName[cand];
          if (!currentGeo?.lat || !g?.lat) {
            bestIdx = i;
            bestDist = 0;
            break;
          }
          const d = haversineKm(currentGeo.lat, currentGeo.lng, g.lat, g.lng);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
          }
        }
        const pick = remaining.splice(bestIdx, 1)[0];
        reordered.push(pick);
        currentGeo = geoByName[pick] || currentGeo;
      }
      orderedPlaces = reordered;
    }
    const rawStops = [hotel, ...orderedPlaces, hotel];
    const geocodedStops = [];
    const unresolvedPlaces = [];
    for (const s of rawStops) {
      const g = await geocodePlace(s, mapsApiKey);
      if (!g?.placeId) {
        if (s === hotel) {
          res.status(400).json({ error: `地点无法解析`, details: s });
          return;
        }
        unresolvedPlaces.push(s);
        continue;
      }
      geocodedStops.push({ raw: s, ...g });
    }
    if (geocodedStops.length < 2) {
      res.status(400).json({ error: "当天可用地点不足（解析失败过多）" });
      return;
    }
    const allLegSummaries = [];
    const allPolylines = [];
    const allLegs = [];
    const stopPoints = [];
    let transitFallbackUsed = false;

    for (let i = 0; i < geocodedStops.length - 1; i += 1) {
      const originStop = geocodedStops[i];
      const destinationStop = geocodedStops[i + 1];
      const origin = originStop.raw;
      const destination = destinationStop.raw;
      const params = new URLSearchParams({
        origin: `place_id:${originStop.placeId}`,
        destination: `place_id:${destinationStop.placeId}`,
        mode,
        key: mapsApiKey,
        language: "zh-CN",
        region: "jp",
      });
      if (mode === "transit") {
        params.set("departure_time", "now");
        params.set("transit_routing_preference", "fewer_transfers");
        params.set("transit_mode", "rail");
      }
      const url = `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`;
      let data = await requestJsonByCurl(url, 12);
      const transitUnavailable =
        mode === "transit" &&
        data.status === "ZERO_RESULTS" &&
        Array.isArray(data.available_travel_modes) &&
        !data.available_travel_modes.includes("TRANSIT");
      if (transitUnavailable) {
        if (strictTransit) {
          res.status(400).json({
            error: `第 ${i + 1} 段无公共交通结果`,
            details: `${origin} -> ${destination}（Google Transit ZERO_RESULTS）`,
          });
          return;
        }
        transitFallbackUsed = true;
        const fallbackParams = new URLSearchParams({
          origin: `place_id:${originStop.placeId}`,
          destination: `place_id:${destinationStop.placeId}`,
          mode: "driving",
          key: mapsApiKey,
          language: "zh-CN",
          region: "jp",
        });
        const fallbackUrl = `https://maps.googleapis.com/maps/api/directions/json?${fallbackParams.toString()}`;
        data = await requestJsonByCurl(fallbackUrl, 12);
      }
      if (data.status !== "OK" || !data.routes?.[0]) {
        res.status(400).json({
          error: `第 ${i + 1} 段路线失败: ${data.status || "UNKNOWN"}`,
          details: data.error_message || `${origin} -> ${destination}`,
        });
        return;
      }

      const route = data.routes[0];
      allPolylines.push(route.overview_polyline?.points || "");
      const leg = route.legs?.[0];
      if (leg) {
        allLegs.push(leg);
        if (i === 0 && leg.start_location) {
          stopPoints.push({
            name: origin,
            lat: leg.start_location.lat,
            lng: leg.start_location.lng,
          });
        }
        if (leg.end_location) {
          stopPoints.push({
            name: destination,
            lat: leg.end_location.lat,
            lng: leg.end_location.lng,
          });
        }
        allLegSummaries.push({
          from: origin,
          to: destination,
          durationText: leg.duration?.text || "",
          distanceText: leg.distance?.text || "",
          estimatedByDriving: transitUnavailable,
          transitUrl: `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=transit`,
          steps: transitUnavailable ? [] : (leg.steps || []).slice(0, 6).map((s) => ({
            mode: s.travel_mode || "",
            instruction: (s.html_instructions || "").replace(/<[^>]+>/g, ""),
            durationText: s.duration?.text || "",
          })),
        });
      }
    }

    res.json({
      orderedStops: rawStops,
      polylines: allPolylines,
      legs: allLegs,
      stopPoints,
      legSummaries: allLegSummaries,
      rawStatus: "OK",
      modeUsed: mode,
      note: transitFallbackUsed
        ? "当前 Directions API 对 transit 返回 ZERO_RESULTS，已用驾车数据估算时长；请使用每段公共交通链接查看真实公交/地铁方案。"
        : mode === "driving"
          ? "当前按驾车模式给出默认最优近似顺序。"
          : "",
      unresolvedPlaces,
    });
  } catch (err) {
    const details =
      err?.code === 28
        ? "网络请求超时（curl timeout，可能无法连通 Google）"
        : err?.code
          ? `网络请求失败: ${err.code}`
          : err.message || "未知异常";
    res.status(500).json({ error: "服务异常", details });
  }
});

app.post("/api/suggest-restaurant-slot", async (req, res) => {
  try {
    if (!mapsApiKey) {
      res.status(500).json({ error: "服务端未配置 GOOGLE_MAPS_API_KEY" });
      return;
    }
    const restaurantName = String(req.body?.restaurantName || "").trim();
    const days = Array.isArray(req.body?.days) ? req.body.days : [];
    if (!restaurantName) {
      res.status(400).json({ error: "请提供餐厅名称" });
      return;
    }
    if (days.length === 0) {
      res.status(400).json({ error: "请提供至少一天行程" });
      return;
    }

    let best = null;
    for (const day of days) {
      const dayName = String(day.dayName || "未命名");
      const places = Array.isArray(day.places) ? day.places.map((p) => String(p || "").trim()).filter(Boolean) : [];
      if (places.length === 0) continue;
      const afterSpot = places[places.length - 1];
      const anchor = await geocodePlace(afterSpot, mapsApiKey);
      if (!anchor?.lat || !anchor?.lng) continue;

      const searchParams = new URLSearchParams({
        query: `${restaurantName} restaurant`,
        location: `${anchor.lat},${anchor.lng}`,
        radius: "5000",
        language: "zh-CN",
        region: "jp",
        key: mapsApiKey,
      });
      const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?${searchParams.toString()}`;
      const searchData = await requestJsonByCurl(searchUrl, 12);
      if (searchData.status !== "OK" || !searchData.results?.length) continue;

      const candidates = searchData.results.slice(0, 5);
      for (const c of candidates) {
        const to = `${c.geometry?.location?.lat},${c.geometry?.location?.lng}`;
        const dirParams = new URLSearchParams({
          origin: `place_id:${anchor.placeId}`,
          destination: to,
          mode: "driving",
          language: "zh-CN",
          region: "jp",
          key: mapsApiKey,
        });
        const dirUrl = `https://maps.googleapis.com/maps/api/directions/json?${dirParams.toString()}`;
        const dirData = await requestJsonByCurl(dirUrl, 10);
        const leg = dirData?.routes?.[0]?.legs?.[0];
        if (!leg?.duration?.value) continue;
        const score = leg.duration.value - (c.rating || 0) * 60;
        if (!best || score < best.score) {
          const suggestedHour = leg.duration.value <= 1200 ? "18:30" : "18:00";
          best = {
            score,
            dayName,
            afterSpot,
            restaurantName: c.name || restaurantName,
            durationText: leg.duration.text || "",
            distanceText: leg.distance?.text || "",
            suggestedTime: suggestedHour,
            mapsUrl: `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(afterSpot)}&destination=${encodeURIComponent(c.name || restaurantName)}&travelmode=driving`,
          };
        }
      }
    }

    if (!best) {
      res.status(400).json({ error: "未找到可推荐门店", details: "请尝试更具体的餐厅名或增加行程地点" });
      return;
    }

    res.json({ best });
  } catch (err) {
    res.status(500).json({ error: "推荐失败", details: err.message || "未知异常" });
  }
});

app.listen(port, () => {
  console.log(`Route planner running at http://localhost:${port}`);
  if (proxyUrl) {
    console.log(`Proxy enabled: ${proxyUrl}`);
  } else {
    console.log("Proxy not set. If Google is unreachable, set HTTP(S)_PROXY.");
  }
});
