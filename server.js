// server.js
require("dotenv").config();

const express = require("express");
const app = express();

const PORT = process.env.PORT || 3000;

const SEOUL_KEY = process.env.SEOUL_KEY;
if (!SEOUL_KEY) {
  console.error("❌ SEOUL_KEY missing. (Render에서는 Settings에서 환경변수로 넣어야 함)");
  // Render에서 바로 죽는 게 원인 파악에 좋아서 throw 유지
  throw new Error("SEOUL_KEY missing");
}

const BASE_XML = `http://openapi.seoul.go.kr:8088/${SEOUL_KEY}/xml/mgisToiletPoi`;

// ✅ public 폴더 정적 서빙: /index.html
app.use(express.static("public"));

// ✅ 서울시 OpenAPI 프록시 (XML 그대로 전달)
app.get("/api/toilets", async (req, res) => {
  const start = Number(req.query.start ?? 1);
  const end = Number(req.query.end ?? 1000);

  const s = Number.isFinite(start) && start > 0 ? start : 1;
  const e = Number.isFinite(end) && end >= s ? end : s + 99;

  const url = `${BASE_XML}/${s}/${e}/`;

  try {
    const r = await fetch(url);
    if (!r.ok) {
      res.status(502).json({ error: "Seoul API error", status: r.status });
      return;
    }
    const xml = await r.text();
    res.set("Content-Type", "application/xml; charset=utf-8");
    res.send(xml);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch Seoul API", detail: String(err) });
  }
});

// ✅ health check
app.get("/health", (req, res) => res.status(200).send("ok"));

app.listen(PORT, () => {
  console.log(`✅ Server running: http://localhost:${PORT}`);
});
