(() => {
  "use strict";

  const dataEl = document.getElementById("papers-data");
  if (!dataEl) return;

  let papers = [];
  try {
    papers = JSON.parse(dataEl.textContent || "[]");
  } catch {
    papers = [];
  }
  if (!Array.isArray(papers)) papers = [];

  const today = document.body.dataset.today || "";
  const last7 = addDays(today, -6);
  const last30 = addDays(today, -29);

  const els = {
    list: document.getElementById("list"),
    empty: document.getElementById("empty"),
    more: document.getElementById("load-more"),
    resultCount: document.getElementById("result-count"),
    search: document.getElementById("search"),
    tags: document.getElementById("tags"),
    sort: document.getElementById("sort-filter"),
    type: document.getElementById("type-filter"),
    month: document.getElementById("month-filter"),
    reset: document.getElementById("reset-filters"),
    overview: document.getElementById("overview"),
    sortHint: document.getElementById("sort-hint"),
    countToday: document.getElementById("count-today"),
    countWeek: document.getElementById("count-week"),
    count30: document.getElementById("count-30d"),
    countAll: document.getElementById("count-all"),
    theme: document.getElementById("theme-toggle"),
  };

  const TYPE_LABEL = {
    "journal-article": "期刊",
    conference: "会议",
    preprint: "预印本",
    chapter: "章节",
    other: "其他",
  };

  const TYPE_CLASS = {
    "journal-article": "journal",
    conference: "conference",
    preprint: "preprint",
  };

  const state = {
    period: "30d",
    q: "",
    tag: "all",
    type: "all",
    month: "all",
    sort: "latest",
    limit: 40,
  };

  const params = new URLSearchParams(window.location.search);
  if (["today", "7d", "30d", "all"].includes(params.get("period"))) {
    state.period = params.get("period");
  }
  state.q = (params.get("q") || "").trim();
  state.tag = params.get("tag") || "all";
  state.type = params.get("type") || "all";
  state.month = params.get("month") || "all";
  state.sort = params.get("sort") === "relevance" ? "relevance" : "latest";

  if (!["all", "journal-article", "conference", "preprint"].includes(state.type)) {
    state.type = "all";
  }

  const counts = {
    today: papers.filter((paper) => paper.firstSeen === today).length,
    "7d": papers.filter((paper) => paper.firstSeen >= last7).length,
    "30d": papers.filter((paper) => paper.firstSeen >= last30).length,
    all: papers.length,
  };

  els.countToday.textContent = counts.today;
  els.countWeek.textContent = counts["7d"];
  els.count30.textContent = counts["30d"];
  els.countAll.textContent = counts.all;

  // ---------- 标签 ----------

  const tagCounts = new Map();
  for (const paper of papers) {
    for (const tag of paper.tags || []) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  const displayTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"))
    .slice(0, 10);

  if (state.tag !== "all" && !tagCounts.has(state.tag)) state.tag = "all";

  function renderTags() {
    els.tags.textContent = "";
    const entries = [["all", papers.length], ...displayTags];
    if (state.tag !== "all" && !displayTags.some(([name]) => name === state.tag)) {
      entries.push([state.tag, tagCounts.get(state.tag) || 0]);
    }

    for (const [name, count] of entries) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `chip${state.tag === name ? " active" : ""}`;
      button.dataset.tag = name;
      button.textContent = name === "all" ? "全部" : name;

      const n = document.createElement("span");
      n.className = "n";
      n.textContent = count;
      button.appendChild(n);
      els.tags.appendChild(button);
    }
  }

  // ---------- 月份 ----------

  const months = [...new Set(
    papers
      .map((paper) => (paper.published || "").slice(0, 7))
      .filter((month) => /^\d{4}-\d{2}$/.test(month)),
  )].sort().reverse();

  if (state.month !== "all" && !months.includes(state.month)) state.month = "all";

  for (const month of months) {
    const option = document.createElement("option");
    option.value = month;
    option.textContent = formatMonth(month);
    els.month.appendChild(option);
  }

  // ---------- 筛选 ----------

  function matches(paper) {
    if (state.period === "today" && paper.firstSeen !== today) return false;
    if (state.period === "7d" && !(paper.firstSeen >= last7)) return false;
    if (state.period === "30d" && !(paper.firstSeen >= last30)) return false;
    if (state.type !== "all" && paper.type !== state.type) return false;
    if (state.month !== "all" && !(paper.published || "").startsWith(state.month)) return false;
    if (state.tag !== "all" && !(paper.tags || []).includes(state.tag)) return false;

    if (state.q) {
      const haystack = [
        paper.title,
        (paper.authors || []).join(" "),
        paper.abstract,
        paper.venue,
        paper.publisher,
        (paper.tags || []).join(" "),
      ]
        .join(" ")
        .toLowerCase();
      const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.every((term) => haystack.includes(term))) return false;
    }

    return true;
  }

  // ---------- 渲染 ----------

  function render() {
    const items = papers.filter(matches);

    if (state.sort === "relevance") {
      items.sort(
        (a, b) =>
          (b.score || 0) - (a.score || 0)
          || (b.published || "").localeCompare(a.published || ""),
      );
    }

    els.resultCount.textContent =
      items.length === papers.length
        ? `共 ${items.length} 篇`
        : `共 ${items.length} 篇（筛选自 ${papers.length} 篇）`;
    els.sortHint.textContent = state.sort === "relevance" ? "按相关性排序" : "按发表时间排序";

    els.list.textContent = "";

    const grouped = state.sort === "latest";
    const monthTotals = new Map();
    if (grouped) {
      for (const paper of items) {
        const month = monthOf(paper);
        monthTotals.set(month, (monthTotals.get(month) || 0) + 1);
      }
    }

    let currentMonth = null;
    for (const paper of items.slice(0, state.limit)) {
      if (grouped) {
        const month = monthOf(paper);
        if (month !== currentMonth) {
          currentMonth = month;
          els.list.appendChild(monthHead(month, monthTotals.get(month) || 0));
        }
      }
      els.list.appendChild(card(paper));
    }

    els.empty.hidden = items.length !== 0;
    els.more.hidden = items.length <= state.limit;
    renderOverview(items);
    updateResetButton();
  }

  function renderOverview(items) {
    const periodLabel = {
      today: "今日",
      "7d": "近 7 天",
      "30d": "近 30 天",
      all: "全部",
    }[state.period] || "当前";

    if (items.length === 0) {
      els.overview.textContent = "当前筛选没有论文，试试放宽时间范围或清空筛选。";
      return;
    }

    const typeCounts = { "journal-article": 0, conference: 0, preprint: 0 };
    const countsByTag = new Map();
    for (const paper of items) {
      if (typeCounts[paper.type] != null) typeCounts[paper.type] += 1;
      for (const tag of paper.tags || []) {
        countsByTag.set(tag, (countsByTag.get(tag) || 0) + 1);
      }
    }

    const typeText = [
      typeCounts["journal-article"] ? `期刊 ${typeCounts["journal-article"]}` : "",
      typeCounts.conference ? `会议 ${typeCounts.conference}` : "",
      typeCounts.preprint ? `预印本 ${typeCounts.preprint}` : "",
    ].filter(Boolean).join(" · ");

    const topTags = [...countsByTag.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"))
      .slice(0, 3)
      .map(([name, count]) => `${name} ${count}`)
      .join("、");

    let text = `当前筛选：${periodLabel} · ${items.length} 篇`;
    if (typeText) text += `（${typeText}）`;
    if (topTags) text += `；高频主题：${topTags}`;
    els.overview.textContent = `${text}。`;
  }

  function updateResetButton() {
    const active =
      state.period !== "30d"
      || Boolean(state.q)
      || state.tag !== "all"
      || state.type !== "all"
      || state.month !== "all"
      || state.sort !== "latest";
    els.reset.hidden = !active;
  }

  function card(paper) {
    const article = document.createElement("article");
    article.className = "paper";

    const top = document.createElement("div");
    top.className = "paper-top";

    const type = paper.type || "other";
    const badge = document.createElement("span");
    badge.className = `badge ${TYPE_CLASS[type] || "preprint"}`;
    badge.textContent = TYPE_LABEL[type] || "其他";
    top.appendChild(badge);

    if (paper.published) {
      const date = document.createElement("span");
      date.className = "date";
      date.textContent = paper.published;
      top.appendChild(date);
    }

    article.appendChild(top);

    const heading = document.createElement("h2");
    const titleLink = document.createElement("a");
    titleLink.href = paper.url || "#";
    titleLink.target = "_blank";
    titleLink.rel = "noopener noreferrer";
    titleLink.textContent = paper.title || "(无标题)";
    heading.appendChild(titleLink);
    article.appendChild(heading);

    if (paper.authors?.length) {
      const authors = document.createElement("p");
      authors.className = "authors";
      authors.textContent = paper.authors.join(", ");
      authors.title = paper.authors.join(", ");
      article.appendChild(authors);
    }

    const venueParts = [];
    if (paper.venue) venueParts.push(paper.venue);
    const publisher = prettyPublisher(paper.publisher);
    const arxivPreprint = paper.type === "preprint" && /^arxiv$/i.test(paper.venue || "");
    if (
      publisher &&
      !arxivPreprint &&
      publisher !== paper.venue &&
      !(paper.venue || "").toLowerCase().includes(publisher.toLowerCase())
    ) {
      venueParts.push(publisher);
    }
    if (venueParts.length) {
      const venue = document.createElement("p");
      venue.className = "venue";
      venue.textContent = venueParts.join(" · ");
      article.appendChild(venue);
    }

    if (paper.abstract) {
      const abstract = document.createElement("p");
      abstract.className = "abstract";
      abstract.textContent = paper.abstract;
      article.appendChild(abstract);

      if (paper.abstract.length > 260) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "expand";
        button.textContent = "展开摘要";
        button.addEventListener("click", () => {
          const open = abstract.classList.toggle("open");
          button.textContent = open ? "收起摘要" : "展开摘要";
        });
        article.appendChild(button);
      }
    }

    if (paper.tags?.length) {
      const tags = document.createElement("div");
      tags.className = "tags";
      for (const tag of paper.tags.slice(0, 6)) {
        const span = document.createElement("span");
        span.className = "tag";
        span.textContent = tag;
        tags.appendChild(span);
      }
      article.appendChild(tags);
    }

    const links = [];
    if (paper.doi) links.push(["DOI", `https://doi.org/${paper.doi}`]);
    if (paper.arxivId) links.push(["arXiv", `https://arxiv.org/abs/${paper.arxivId}`]);
    if (paper.pdfUrl) links.push(["PDF", paper.pdfUrl]);

    if (links.length) {
      const row = document.createElement("div");
      row.className = "links";
      for (const [label, href] of links) {
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.textContent = `${label} ↗`;
        row.appendChild(anchor);
      }
      article.appendChild(row);
    }

    return article;
  }

  function monthHead(month, count) {
    const div = document.createElement("div");
    div.className = "month-head";

    const label = document.createElement("span");
    label.textContent = month === "unknown" ? "日期未知" : formatMonth(month);

    const total = document.createElement("span");
    total.className = "n";
    total.textContent = `${count} 篇`;

    div.append(label, total);
    return div;
  }

  // ---------- 交互 ----------

  const periodButtons = [...document.querySelectorAll("[data-period]")];

  function setPeriod(period) {
    state.period = period;
    state.limit = 40;
    for (const button of periodButtons) {
      button.classList.toggle("active", button.dataset.period === period);
    }
    syncUrl();
    render();
  }

  for (const button of periodButtons) {
    button.addEventListener("click", () => setPeriod(button.dataset.period));
  }

  els.search.value = state.q;
  let searchTimer;
  els.search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.q = els.search.value.trim();
      state.limit = 40;
      syncUrl();
      render();
    }, 140);
  });

  els.sort.value = state.sort;
  els.sort.addEventListener("change", () => {
    state.sort = els.sort.value === "relevance" ? "relevance" : "latest";
    state.limit = 40;
    syncUrl();
    render();
  });

  els.type.value = state.type;
  els.type.addEventListener("change", () => {
    state.type = els.type.value;
    state.limit = 40;
    syncUrl();
    render();
  });

  els.month.value = state.month;
  els.month.addEventListener("change", () => {
    state.month = els.month.value;
    state.limit = 40;
    syncUrl();
    render();
  });

  els.reset.addEventListener("click", () => {
    state.period = "30d";
    state.q = "";
    state.tag = "all";
    state.type = "all";
    state.month = "all";
    state.sort = "latest";
    state.limit = 40;
    els.search.value = "";
    els.type.value = "all";
    els.month.value = "all";
    els.sort.value = "latest";
    for (const button of periodButtons) {
      button.classList.toggle("active", button.dataset.period === "30d");
    }
    renderTags();
    syncUrl();
    render();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
    const tag = document.activeElement?.tagName;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
    event.preventDefault();
    els.search.focus();
  });

  els.tags.addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (!chip) return;
    state.tag = chip.dataset.tag || "all";
    state.limit = 40;
    renderTags();
    syncUrl();
    render();
  });

  els.more.addEventListener("click", () => {
    state.limit += 40;
    render();
  });

  function syncUrl() {
    const url = new URL(window.location.href);
    const query = url.searchParams;
    for (const key of ["period", "q", "tag", "type", "month", "sort"]) query.delete(key);
    if (state.period !== "30d") query.set("period", state.period);
    if (state.q) query.set("q", state.q);
    if (state.tag !== "all") query.set("tag", state.tag);
    if (state.type !== "all") query.set("type", state.type);
    if (state.month !== "all") query.set("month", state.month);
    if (state.sort !== "latest") query.set("sort", state.sort);

    const search = query.toString();
    history.replaceState(null, "", `${url.pathname}${search ? `?${search}` : ""}${url.hash}`);
  }

  // ---------- 主题 ----------

  const root = document.documentElement;
  const savedTheme = localStorage.getItem("theme");
  if (savedTheme === "dark" || savedTheme === "light") root.dataset.theme = savedTheme;

  function currentTheme() {
    if (root.dataset.theme) return root.dataset.theme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function updateThemeButton() {
    const dark = currentTheme() === "dark";
    els.theme.textContent = dark ? "☀" : "☾";
    els.theme.title = dark ? "切换到浅色模式" : "切换到深色模式";
  }

  els.theme.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    localStorage.setItem("theme", next);
    updateThemeButton();
  });

  // ---------- 初始化 ----------

  renderTags();
  updateThemeButton();
  els.sort.value = state.sort;
  for (const button of periodButtons) {
    button.classList.toggle("active", button.dataset.period === state.period);
  }
  render();

  function addDays(isoDate, days) {
    const date = new Date(`${isoDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function monthOf(paper) {
    const month = (paper.published || "").slice(0, 7);
    return /^\d{4}-\d{2}$/.test(month) ? month : "unknown";
  }

  function formatMonth(month) {
    if (month === "unknown") return "日期未知";
    const [year, value] = month.split("-");
    return `${year}年${Number(value)}月`;
  }

  function prettyPublisher(name) {
    const value = String(name || "").trim();
    if (!value) return "";
    if (/ieee/i.test(value)) return "IEEE";
    if (/elsevier/i.test(value)) return "Elsevier";
    if (/springer/i.test(value)) return "Springer";
    if (/wiley/i.test(value)) return "Wiley";
    if (/mdpi|multidisciplinary digital/i.test(value)) return "MDPI";
    if (/association for computing machinery|\bacm\b/i.test(value)) return "ACM";
    if (/arxiv|cornell/i.test(value)) return "arXiv";
    return value;
  }
})();
