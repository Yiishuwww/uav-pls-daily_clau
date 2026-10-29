// 相关性硬门槛、打分与主题标签

import { addDays, countTerm, normalize, termPositions } from "./text.js";

const stripForwardSecrecy = (text) =>
  text.replace(/\b(?:perfect\s+)?forward\s+secrecy\b/g, " ").replace(/\s+/g, " ").trim();

export function evaluatePaper(paper, keywords, today) {
  const title = stripForwardSecrecy(normalize(paper.title));
  const abstract = stripForwardSecrecy(normalize(paper.abstract));
  const full = `${title} ${abstract}`;

  const excluded = (keywords.exclude_title_patterns ?? []).some((pattern) =>
    new RegExp(pattern, "i").test(title),
  );
  if (excluded) {
    return { pass: false, score: 0, tags: [], reason: "excluded-title" };
  }

  const plsTitle = keywords.pls_terms.filter((term) => countTerm(title, term) > 0);
  const uavTitle = keywords.uav_terms.filter((term) => countTerm(title, term) > 0);
  const plsAbstract = keywords.pls_terms.filter((term) => countTerm(abstract, term) > 0);
  const uavAbstract = keywords.uav_terms.filter((term) => countTerm(abstract, term) > 0);

  const weakTerms = new Set((keywords.weak_pls_terms ?? []).map(normalize));
  const strongTerms = keywords.pls_terms.filter((term) => !weakTerms.has(normalize(term)));
  const strongHits = strongTerms.filter(
    (term) => countTerm(title, term) > 0 || countTerm(abstract, term) > 0,
  ).length;

  // 强 PLS 词与 UAV 词必须在同一段邻近文本中出现，避免摘要两端各提一次造成误收
  const proximity = keywords.proximity_chars ?? 260;
  const strongPositions = strongTerms.flatMap((term) => termPositions(full, term));
  const uavPositions = keywords.uav_terms.flatMap((term) => termPositions(full, term));
  const nearEnough = strongPositions.some((position) =>
    uavPositions.some((uavPosition) => Math.abs(position - uavPosition) <= proximity),
  );

  const pass = strongHits > 0 && uavTitle.length + uavAbstract.length > 0 && nearEnough;

  const weights = keywords.scoring ?? {};
  let score = 0;
  score += Math.min(plsTitle.length, 2) * (weights.title_pls ?? 6);
  score += Math.min(uavTitle.length, 2) * (weights.title_uav ?? 5);
  score += Math.min(plsAbstract.length, 3) * (weights.abstract_pls ?? 2);
  score += Math.min(uavAbstract.length, 2) * (weights.abstract_uav ?? 1.5);
  if (plsTitle.length > 0 && uavTitle.length > 0) {
    score += weights.both_title_bonus ?? 4;
  }
  if (paper.type === "journal-article") score += weights.journal_bonus ?? 2;
  if (paper.type === "conference") score += weights.conference_bonus ?? 1;

  const recentSince = addDays(today, -7);
  if (paper.published && paper.published >= recentSince) {
    score += weights.recency_bonus ?? 2;
  }

  const tags = [];
  for (const tag of keywords.tags ?? []) {
    if (!tag?.name || !Array.isArray(tag.patterns)) continue;
    const hit = tag.patterns.some((pattern) => {
      try {
        return new RegExp(pattern, "i").test(full);
      } catch {
        return false;
      }
    });
    if (hit) tags.push(tag.name);
  }

  return {
    pass,
    score: Math.round(score * 10) / 10,
    tags,
    matched: {
      pls: [...new Set([...plsTitle, ...plsAbstract])],
      uav: [...new Set([...uavTitle, ...uavAbstract])],
    },
  };
}
