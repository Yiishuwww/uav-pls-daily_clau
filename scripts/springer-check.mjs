#!/usr/bin/env node
// 诊断 Springer Nature key：测试 v2/v1、简单/布尔/字段查询、Open Access 端点。
// 用法：
//   $env:SPRINGER_API_KEY = "你的key"
//   node scripts/springer-check.mjs

const key = process.env.SPRINGER_API_KEY;
if (!key) {
  console.log("未设置 SPRINGER_API_KEY");
  process.exit(1);
}

const cases = [
  {
    name: "v2 simple: UAV",
    base: "https://api.springernature.com/meta/v2/json",
    q: "UAV",
  },
  {
    name: "v2 two terms: UAV security",
    base: "https://api.springernature.com/meta/v2/json",
    q: "UAV security",
  },
  {
    name: "v2 quoted phrase",
    base: "https://api.springernature.com/meta/v2/json",
    q: '"physical layer security"',
  },
  {
    name: "v2 boolean",
    base: "https://api.springernature.com/meta/v2/json",
    q: "UAV AND security",
  },
  {
    name: "v2 field: title",
    base: "https://api.springernature.com/meta/v2/json",
    q: "title:UAV",
  },
  {
    name: "v1 simple: UAV",
    base: "https://api.springernature.com/meta/v1/json",
    q: "UAV",
  },
  {
    name: "v1 quoted phrase",
    base: "https://api.springernature.com/meta/v1/json",
    q: '"physical layer security"',
  },
  {
    name: "openaccess simple: UAV",
    base: "https://api.springernature.com/openaccess/json",
    q: "UAV",
  },
];

for (const item of cases) {
  const url = new URL(item.base);
  url.searchParams.set("q", item.q);
  url.searchParams.set("api_key", key);
  url.searchParams.set("s", "1");
  url.searchParams.set("p", "2");

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "uav-pls-springer-check",
      },
    });
    const text = await response.text();
    console.log(`--- ${item.name}: HTTP ${response.status}`);
    console.log(text.slice(0, 260).replace(/\s+/g, " "));
  } catch (error) {
    console.log(`--- ${item.name}: ERR ${error.message}`);
  }
}
