
require("dotenv").config();

const SEOUL_KEY = process.env.SEOUL_KEY;
if (!SEOUL_KEY) throw new Error("SEOUL_KEY missing. Check .env");


const BASE_XML = `http://openapi.seoul.go.kr:8088/${SEOUL_KEY}/xml/mgisToiletPoi`;

app.use(express.static("public"));

// ---- 캐시(서버 켜져있는 동안 유지) ----
let cache = { at: 0, rows: null };
const CACHE_TTL_MS = 1000 * 60 * 60; // 1시간

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseXmlRowsToJson(xmlText) {
  const { DOMParser } = require("@xmldom/xmldom");
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");

  const rows = [
    ...Array.from(doc.getElementsByTagName("row")),
    ...Array.from(doc.getElementsByTagName("Row")),
  ];
  if (!rows.length) return [];

  const rowToUpperMap = (row) => {
    const m = {};
    const children = Array.from(row.childNodes).filter((n) => n.nodeType === 1);
    for (const el of children) {
      m[String(el.nodeName).toUpperCase()] = String(el.textContent || "").trim();
    }
    return m;
  };

  const pick = (m, ...keys) => {
    for (const k of keys) {
      const v = m[String(k).toUpperCase()];
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
    return "";
  };

  return rows.map((r) => {
    const m = rowToUpperMap(r);

    return {
      toiletId: pick(m, "OBJECTID", "ID", "POI_ID", "TOILET_ID", "MGIS_ID"),
      name: pick(m, "CONTS_NAME", "FNAME", "TOILET_NM", "NAME", "NM"),
      addr: pick(m, "ADDR_NEW") || pick(m, "ADDR_OLD") || pick(m, "ADR", "ADDR", "ADDRESS"),
      lat: pick(m, "COORD_Y", "Y_WGS84", "LAT", "Y"),
      lng: pick(m, "COORD_X", "X_WGS84", "LNG", "X"),
      gu: pick(m, "GU_NAME"),
      tel: pick(m, "TEL_NO"),
      openType: pick(m, "VALUE_01"),
      openTime: pick(m, "VALUE_02"),
      gender: pick(m, "VALUE_04"),
      safety: pick(m, "VALUE_07"),
      placeType: pick(m, "VALUE_08"),
      manager: pick(m, "VALUE_09"),
    };
  });
}

// (선택) XML 프록시
app.get("/api/toilets", async (req, res) => {
  const start = Number(req.query.start ?? 1);
  const end = Number(req.query.end ?? 60);
  const s = Number.isFinite(start) && start > 0 ? start : 1;
  const e = Number.isFinite(end) && end >= s ? end : s + 59;

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

// ✅ 서울 전체 JSON (페이지네이션 자동)
app.get("/api/toilets/all", async (req, res) => {
  const now = Date.now();
  if (cache.rows && now - cache.at < CACHE_TTL_MS) {
    return res.json({ cached: true, count: cache.rows.length, rows: cache.rows });
  }

  const PAGE_SIZE = 1000;
  let start = 1;
  const all = [];

  try {
    while (true) {
      const end = start + PAGE_SIZE - 1;
      const url = `${BASE_XML}/${start}/${end}/`;

      const r = await fetch(url);
      const xml = await r.text();

      const rows = parseXmlRowsToJson(xml);
      if (!rows.length) break;

      for (const t of rows) {
        if (t.toiletId) all.push(t);
      }

      start += PAGE_SIZE;
      await sleep(120); // 과호출 방지
    }

    // 중복 제거
    const uniq = new Map();
    for (const t of all) {
      if (!uniq.has(t.toiletId)) uniq.set(t.toiletId, t);
    }

    const rows = Array.from(uniq.values()).filter(
      (t) => t.name && t.addr && t.lat && t.lng
    );

    cache = { at: Date.now(), rows };

    res.json({ cached: false, count: rows.length, rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch all", detail: String(err) });
  }
});

app.listen(PORT, () => console.log(`✅ http://localhost:${PORT}`));
