// 以 Git 仓库中的 JSON 作为数据库

import fs from "node:fs";
import path from "node:path";

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function loadStore(root) {
  return readJson(path.join(root, "data", "papers.json"), {
    version: 1,
    updatedAt: "",
    papers: [],
  });
}

export function saveStore(root, store) {
  writeJson(path.join(root, "data", "papers.json"), store);
}

export function loadStatus(root) {
  return readJson(path.join(root, "data", "status.json"), {
    updatedAt: "",
    updatedCN: "",
    sources: [],
  });
}

export function saveStatus(root, status) {
  writeJson(path.join(root, "data", "status.json"), status);
}
