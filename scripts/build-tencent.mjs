// 组装腾讯云 SCF Web 函数部署包：dist/tencent/
// 结构：
//   server.mjs
//   push.mjs
//   worker/src/chat.js
//   worker/src/prompt.js
//   node_modules/@pushforge/builder
//   papers.json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist", "tencent");
const zipPath = path.join(root, "dist", "uav-pls-chat-tencent.zip");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

fs.copyFileSync(
  path.join(root, "tencent", "server.mjs"),
  path.join(outDir, "server.mjs"),
);

fs.copyFileSync(
  path.join(root, "tencent", "push.mjs"),
  path.join(outDir, "push.mjs"),
);

fs.mkdirSync(path.join(outDir, "worker", "src"), { recursive: true });
for (const file of ["chat.js", "prompt.js"]) {
  fs.copyFileSync(
    path.join(root, "worker", "src", file),
    path.join(outDir, "worker", "src", file),
  );
}

const builderDir = path.join(outDir, "node_modules", "@pushforge", "builder");
fs.mkdirSync(path.dirname(builderDir), { recursive: true });
fs.cpSync(path.join(root, "node_modules", "@pushforge", "builder"), builderDir, {
  recursive: true,
});

fs.copyFileSync(
  path.join(root, "docs", "data", "papers.json"),
  path.join(outDir, "papers.json"),
);

const papers = JSON.parse(fs.readFileSync(path.join(outDir, "papers.json"), "utf8"));

console.log(`已生成部署目录: ${outDir}`);
console.log(`内置论文数: ${papers.papers?.length ?? 0}`);
console.log("");
console.log("接着在 PowerShell 里执行下面这行，生成 ZIP：");
console.log(`tar.exe -a -c -f "${zipPath}" -C "${outDir}" .`);
console.log("");
console.log("然后在腾讯云 SCF 控制台上传这个 ZIP。");
