(() => {
  "use strict";

  const toggle = document.getElementById("chat-toggle");
  const panel = document.getElementById("chat-panel");
  if (!toggle || !panel) return;

  const els = {
    close: document.getElementById("chat-close"),
    clear: document.getElementById("chat-clear"),
    log: document.getElementById("chat-log"),
    form: document.getElementById("chat-form"),
    input: document.getElementById("chat-input"),
    send: document.getElementById("chat-send"),
    stop: document.getElementById("chat-stop"),
    suggest: document.getElementById("chat-suggest"),
  };
  if (Object.values(els).some((element) => !element)) return;

  const meta = document.querySelector('meta[name="chat-api-url"]');
  const API_URL = (meta?.content || "/api/chat").trim() || "/api/chat";

  let papers = [];
  try {
    papers = JSON.parse(document.getElementById("papers-data")?.textContent || "[]");
  } catch {
    papers = [];
  }
  if (!Array.isArray(papers)) papers = [];

  const state = {
    open: false,
    busy: false,
    history: [],
    abort: null,
  };

  const SUGGESTIONS = [
    "最近 30 天有哪些值得关注的论文？",
    "有哪些关于 RIS/IRS 的论文？",
    "这些论文主要研究哪些物理层安全技术？",
    "帮我总结最新的一篇论文。",
  ];

  // ---------- 界面 ----------

  function setOpen(open, { focus = true } = {}) {
    state.open = open;
    panel.hidden = !open;
    toggle.hidden = open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");

    if (open) {
      resizeInput();
      els.input.focus();
      scrollLog();
    } else if (focus) {
      toggle.focus();
    }
  }

  function setBusy(busy) {
    state.busy = busy;
    els.send.disabled = busy;
    els.clear.disabled = busy;
    els.input.disabled = busy;
    els.stop.hidden = !busy;
    if (!busy && state.open) els.input.focus();
  }

  function scrollLog() {
    els.log.scrollTop = els.log.scrollHeight;
  }

  function addMessage(role, content) {
    const item = document.createElement("div");
    item.className = `chat-msg ${role}`;

    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    if (content) bubble.textContent = content;

    item.appendChild(bubble);
    els.log.appendChild(item);
    scrollLog();
    return { item, bubble };
  }

  function addWelcome() {
    const count = papers.length;
    addMessage(
      "bot",
      count > 0
        ? `你好，我是本站的论文助手。我会基于页面收录的 ${count} 篇论文回答；回答里的 [n] 是引用编号，点一下可以定位到对应论文卡片。`
        : "你好，我是本站的论文助手。当前页面没有论文数据，请先生成网站数据。",
    );
  }

  function renderSuggestions() {
    els.suggest.textContent = "";
    if (papers.length === 0) return;

    for (const text of SUGGESTIONS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chat-suggest-item";
      button.textContent = text;
      button.addEventListener("click", () => send(text));
      els.suggest.appendChild(button);
    }
  }

  // ---------- 发送与流式接收 ----------

  async function send(rawQuestion) {
    const question = String(rawQuestion ?? els.input.value).trim();
    if (!question || state.busy) return;

    els.input.value = "";
    resizeInput();
    addMessage("user", question);
    state.history.push({ role: "user", content: question });
    trimHistory();

    const { bubble } = addMessage("bot", "思考中…");
    bubble.classList.add("streaming");
    setBusy(true);

    const controller = new AbortController();
    state.abort = controller;

    let answer = "";

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          history: state.history.slice(0, -1).slice(-8),
          filters: window.uavApp?.getFilters?.() ?? null,
        }),
        signal: controller.signal,
      });

      if (response.status === 404 || response.status === 405) {
        throw new Error(
          "AI 服务未配置或端点不可用。请先部署 Worker，并在构建时设置 CHAT_API_URL。",
        );
      }

      if (!response.ok) {
        let message = `请求失败（${response.status}）`;
        try {
          const data = await response.json();
          if (data?.error) message = data.error;
        } catch {
          // 忽略非 JSON 错误体。
        }
        throw new Error(message);
      }

      const contentType = response.headers.get("content-type") || "";

      if (contentType.includes("application/json")) {
        const data = await response.json();
        answer = String(data?.answer || "");
        if (!answer) throw new Error(data?.error || "AI 没有返回内容");
        bubble.textContent = answer;
      } else {
        if (!response.body) throw new Error("当前浏览器不支持流式响应");

        await readSse(response.body, (event) => {
          if (event.error) throw new Error(event.error);
          if (event.done) return;
          if (typeof event.text !== "string" || !event.text) return;

          if (!answer) bubble.textContent = "";
          answer += event.text;
          bubble.textContent = answer;
          scrollLog();
        });
      }

      if (!answer.trim()) throw new Error("AI 没有返回内容");

      bubble.classList.remove("streaming");
      bubble.innerHTML = renderAnswer(answer);
      state.history.push({ role: "assistant", content: answer });
      trimHistory();
    } catch (error) {
      bubble.classList.remove("streaming");

      if (error?.name === "AbortError") {
        if (answer) {
          bubble.innerHTML = `${renderAnswer(answer)}<p class="chat-note">（已停止）</p>`;
          state.history.push({ role: "assistant", content: answer });
          trimHistory();
        } else {
          bubble.classList.add("error");
          bubble.textContent = "已停止。";
        }
      } else {
        const detail = describeError(error);
        if (answer) {
          bubble.innerHTML = `${renderAnswer(answer)}<p class="chat-note">${escapeHtml(detail)}</p>`;
        } else {
          bubble.classList.add("error");
          bubble.textContent = detail;
        }
        const last = state.history[state.history.length - 1];
        if (last?.role === "user" && last.content === question) {
          state.history.pop();
        }
      }
    } finally {
      state.abort = null;
      setBusy(false);
      scrollLog();
    }
  }

  async function readSse(body, onEvent) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, "\n");

        let index;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);

          for (const line of block.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data) continue;

            let event;
            try {
              event = JSON.parse(data);
            } catch {
              continue;
            }

            onEvent(event);
            if (event.done) return;
          }
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
  }

  function trimHistory() {
    while (state.history.length > 8) state.history.shift();
    while (state.history.length > 0 && state.history[0].role !== "user") {
      state.history.shift();
    }
  }

  function describeError(error) {
    const message = String(error?.message || error || "");
    if (/Failed to fetch|NetworkError|Load failed|network error/i.test(message)) {
      return "网络异常，无法连接 AI 服务，请稍后再试。";
    }
    return message || "请求失败，请稍后再试。";
  }

  // ---------- 回答渲染 ----------

  function renderAnswer(raw) {
    const text = escapeHtml(String(raw || "").trim());
    if (!text) return "";

    const lines = text.split("\n");
    const out = [];
    let list = null;

    const flushList = () => {
      if (!list) return;
      out.push(
        `<${list.type}>${list.items.map((item) => `<li>${item}</li>`).join("")}</${list.type}>`,
      );
      list = null;
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || /^[-*_]{3,}$/.test(line)) {
        flushList();
        continue;
      }

      const heading = line.match(/^#{1,6}\s+(.+)$/);
      if (heading) {
        flushList();
        out.push(`<p class="chat-h">${inline(heading[1])}</p>`);
        continue;
      }

      const bullet = line.match(/^[-*•]\s+(.+)$/);
      if (bullet) {
        if (!list || list.type !== "ul") {
          flushList();
          list = { type: "ul", items: [] };
        }
        list.items.push(inline(bullet[1]));
        continue;
      }

      const numbered = line.match(/^\d+[.、)]\s+(.+)$/);
      if (numbered) {
        if (!list || list.type !== "ol") {
          flushList();
          list = { type: "ol", items: [] };
        }
        list.items.push(inline(numbered[1]));
        continue;
      }

      flushList();
      out.push(`<p>${inline(line)}</p>`);
    }

    flushList();
    return out.join("");
  }

  function inline(text) {
    let html = text;
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g, (match, group) => {
      const numbers = group.split(/\s*,\s*/).map(Number);
      if (!numbers.every((n) => papers[n - 1])) return match;
      return numbers.map((n) => cite(n)).join("");
    });
    return html;
  }

  function cite(n) {
    const paper = papers[n - 1];
    const title = escapeHtml(paper?.title || "");
    return `<button type="button" class="chat-cite" data-n="${n}" title="${title}">${n}</button>`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ---------- 交互 ----------

  toggle.addEventListener("click", () => setOpen(true));
  els.close.addEventListener("click", () => setOpen(false));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.open) setOpen(false);
  });

  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    send();
  });

  els.stop.addEventListener("click", () => state.abort?.abort());

  els.clear.addEventListener("click", () => {
    if (state.busy) return;
    state.history = [];
    els.log.textContent = "";
    addWelcome();
    renderSuggestions();
  });

  els.log.addEventListener("click", (event) => {
    const button = event.target.closest(".chat-cite");
    if (!button) return;

    const n = Number(button.dataset.n);
    if (!Number.isInteger(n) || n < 1) return;

    if (window.uavApp?.revealPaper?.(n)) {
      setOpen(false);
      return;
    }

    const paper = papers[n - 1];
    if (paper?.url) window.open(paper.url, "_blank", "noopener,noreferrer");
  });

  function resizeInput() {
    els.input.style.height = "auto";
    els.input.style.height = `${Math.min(els.input.scrollHeight, 120)}px`;
  }

  els.input.addEventListener("input", resizeInput);
  els.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      els.form.requestSubmit();
    }
  });

  // ---------- 初始化 ----------

  addWelcome();
  renderSuggestions();
  setOpen(false, { focus: false });
})();
