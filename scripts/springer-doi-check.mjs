#!/usr/bin/env node
// 检查 Springer Meta API 能否按 DOI 查到记录（用于补摘要）。
// 用法：
//   $env:SPRINGER_API_KEY = "你的key"
//   node scripts/springer-doi-check.mjs 10.1007/s10878-026-01491-8

const key = process.env.SPRINGER_API_KEY;
if (!key) {
  console.log("未设置 SPRINGER_API_KEY");
  process.exit(1);
}

const doi = String(process.argv[2] || "10.1007/s10878-026-01491-8").trim();
const queries = [doi, `"${doi}"`];

for (const q of queries) {
  const url = new URL("https://api.springernature.com/meta/v2/json");
  url.searchParams.set("q", q);
  url.searchParams.set("api_key", key);
  url.searchParams.set("s", "1");
  url.searchParams.set("p", "3");

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "uav-pls-springer-doi-check",
      },
    });
    const data = await response.json();
    console.log(`--- q=${q} -> HTTP ${response.status}, total=${data.result?.[0]?.total}`);
    for (const record of data.records || []) {
      console.log(
        "  record:",
        record.identifier || record.doi || "(no doi)",
        "|",
        String(record.title || "").slice(0, 90),
        "| abstract:",
        String(record.abstract || "").length,
      );
    }
  } catch (error) {
    console.log(`--- q=${q} -> ERR ${error.message}`);
  }
}
