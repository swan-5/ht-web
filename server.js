// server.js
require("dotenv").config();

const express = require("express");
const path = require("path");
const { XMLParser } = require("fast-xml-parser");

const app = express();
const PORT = process.env.PORT || 3000;

const SEOUL_KEY = process.env.SEOUL_KEY;
if (!SEOUL_KEY) {
  throw new Error("SEOUL_KEY missing. Render Settings → Environment Variables에 SEOUL_KEY 추가해야 함");
}

const BASE_XML = `http://openapi.seoul.go.kr:8088/${SEOUL_KEY}/xml/mgisToiletPoi`;

// ✅ public 폴더 서비스: /index.html
app.use(express.static(path.join(__dirname, "public")));

// ------------------------------
// XML -> rows 안전 파싱
// ------------------------------
const parser = new XMLParser({ ignoreAttributes: true });

function normalizeRowsFromXml(xmlText) {
  const obj = parser.parse(xmlText);

  // 보통 obj.mgisToiletPoi.row 형태
  const root = obj?.mgisToiletPoi || obj?.MGISTOILETPOI || obj;
  const rows = root?.row || [];
  const arr = Array.isArray(rows) ? rows : (rows ? [rows] : []);

  // 프론트가 쓰는 키로 정규화
  return arr.map((r, i) => ({
    toiletId: r.POI_ID || r.OBJECTID || r.ID || `ROW_${i + 1}`,
    name: r.FNAME || r.CONTS_NAME || r.TOILET_NM || r.NAME || "",
    addr: r.ADR || r.ADDR_NEW || r.ADDR || r.ADDRESS || "",
    lat: r.Y_WGS84 || r.COORD_Y || r.LAT || "",
    lng: r.X_WGS84 || r.COORD_X || r.LNG || "",
    gu: r.GU_NAME || "",
    tel: r.TEL_NO || "",
    openType: r.VALUE_01 || "",   // 공공개방/민간개방 등
    openTime: r.VALUE_02 || "",   // 운영시간
    gender: r.VALUE_04 || "",     // 남자|여자| 등
  }));
}

// ------------------------------
// ✅ (선택) 일부 구간 XML 프록시: /api/toilets?start=1&end=1000
// ------------------------------
app.get("/api/toilets", async (req, res) => {
  const start = Number(req.query.start ?? 1);
  const end = Number(req.query.end ?? 100);

  const s = Number.isFinite(start) && start > 0 ? start : 1;
  const e = Number.isFinite(end) && end >= s ? end : s + 99;

  const url = `${BASE_XML}/${s}/${e}/`;

  try {
    const r = await fetch(url);
    const xml = await r.text();
    res.set("Content-Type", "application/xml; charset=utf-8");
    res.send(xml);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch Seoul API", detail: String(err) });
  }
});

// ------------------------------
// ✅ 전체 JSON: /api/toilets/all
// - 프론트에서 지금 이걸 호출함!
// - 캐시로 속도/안정성 확보
// ------------------------------
let cache = { at: 0, rows: [] };
const CACHE_TTL_MS = 1000 * 60 * 30; // 30분 캐시

app.get("/api/toilets/all", async (req, res) => {
  try {
    const now = Date.now();
    if (cache.rows.length && now - cache.at < CACHE_TTL_MS) {
      return res.json({ rows: cache.rows, cached: true });
    }

    const CHUNK = 1000;
    const MAX = 20000; // 넉넉히 (서울 전체가 이보다 적으면 알아서 중단됨)
    let start = 1;

    const all = [];

    while (start <= MAX) {
      const end = start + CHUNK - 1;
      const url = `${BASE_XML}/${start}/${end}/`;

      const r = await fetch(url);
      const xml = await r.text();

      const part = normalizeRowsFromXml(xml);

      // 더 이상 없으면 중단
      if (part.length === 0) break;

      all.push(...part);

      // 마지막 청크가 덜 찼으면 끝
      if (part.length < CHUNK) break;

      start += CHUNK;
    }

    cache = { at: now, rows: all };
    res.json({ rows: all, cached: false });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch all toilets", detail: String(err) });
  }
});

app.get("/health", (req, res) => res.status(200).send("ok"));

app.listen(PORT, () => console.log(`✅ http://localhost:${PORT}`));
