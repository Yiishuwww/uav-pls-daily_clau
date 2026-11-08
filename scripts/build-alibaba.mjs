// 组装阿里云函数计算 FC Web 函数部署包：dist/alibaba/
// 结构：
//   server.mjs
//   worker/src/chat.js
//   worker/src/prompt.js
//   papers.json
//
// FC 控制台创建函数时：
//   启动命令：node server.mjs
//   监听端口：9000
//   HTTP 触发器请求方法：GET, POST, OPTIONS

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist", "alibaba");
const zipPath = path.join(root, "dist", "uav-pls-chat-alibaba.zip");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

fs.copyFileSync(
  path.join(root, "tencent", "server.mjs"),
  path.join(outDir, "server.mjs"),
);

fs.mkdirSync(path.join(outDir, "worker", "src"), { recursive: true });
for (const file of ["chat.js", "prompt.js"]) {
  fs.copyFileSync(
    path.join(root, "worker", "src", file),
    path.join(outDir, "worker", "src", file),
  );
}

fs.copyFileSync(
  path.join(root, "docs", "data", "papers.json"),
  path.join(outDir, "papers.json"),
);

const papers = JSON.parse(fs.readFileSync(path.join(outDir, "papers.json"), "utf8"));

console.log(`已生成部署目录: ${outDir}`);
console.log(`内置论文数: ${papers.papers?.length ?? 0}`);
console.log("");
console.log("阿里云 FC 创建 Web 函数时填写：");
console.log("  启动命令: node server.mjs");
console.log("  监听端口: 9000");
console.log("  HTTP 触发器方法: GET, POST, OPTIONS");
console.log("  执行超时: 120 秒");
console.log("");
console.log("生成 ZIP：");
console.log(`tar.exe -a -c -f "${zipPath}" -C "${outDir}" .`);
console.log("");
console.log("然后在上传代码处选择这个 ZIP。");
