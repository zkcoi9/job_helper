// ==UserScript==
// @name         猎聘海投助手
// @namespace    local.liepin
// @version      0.4.0
// @description  猎聘职位列表页助手：排除猎头，依次自动「聊一聊」打招呼（猎聘自动发送招呼语）。筛选沿用页面自带筛选器。
// @match        https://www.liepin.com/zhaopin/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  "use strict";

  /* ==================================================================
   * 一、可调参数
   * ================================================================== */
  const CONFIG = {
    // 每个职位间隔（毫秒）
    interval: 3500,
    // 点完「聊一聊」后等待聊天窗出现的最长时间
    waitChatWindow: 8000,
    // 单次会话最多打招呼多少个
    maxPerSession: 20,
  };

  /* ==================================================================
   * 二、猎头判定
   * ================================================================== */
  const HEADHUNTER_TAGS = ["广告", "猎头", "推广", "置顶", "付费", "品牌推广"];
  const HEADHUNTER_COMPANY_KW = [
    "猎头", "人力资源", "人才", "顾问", "外包", "劳务", "派遣",
    "hire", "科锐", "万宝盛华", "中智", "外企德科", "蓝聘", "锐仕",
  ];
  // 明确要避开的按钮文案
  const AVOID_BTN = ["举报", "收藏", "分享", "不合适", "查看反馈", "取消", "关闭"];

  /* ==================================================================
   * 三、基础工具
   * ================================================================== */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const txt = (el, n) =>
    ((el && (el.innerText || el.textContent)) || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, n || 200);

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return true;
    return !!el.offsetParent;
  }

  async function waitFor(fn, timeout, step) {
    const t0 = Date.now();
    const to = timeout || 8000;
    while (Date.now() - t0 < to) {
      let v = null;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return v;
      await sleep(step || 250);
    }
    return null;
  }

  /* ==================================================================
   * 四、页面识别
   * ================================================================== */
  function isListPage() {
    return (
      /\/zhaopin\//.test(location.pathname) ||
      !!document.querySelector("div.jobCardPcContainer")
    );
  }

  /* ==================================================================
   * 五、日志 / UI
   * ================================================================== */
  function log(msg, level) {
    const box = document.getElementById("lph_log");
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    if (box) {
      const d = document.createElement("div");
      d.style.cssText =
        "padding:3px 8px;font-size:12px;line-height:1.6;border-bottom:1px solid #f0f0f0;word-break:break-all;" +
        (level === "err" ? "color:#c0392b;"
          : level === "ok" ? "color:#1a7f37;"
          : level === "warn" ? "color:#b7791f;"
          : "color:#24292f");
      d.textContent = line;
      box.appendChild(d);
      box.scrollTop = box.scrollHeight;
    }
    console.log("[猎聘助手]", msg);
  }

  function updateStat() {
    const s = document.getElementById("lph_stat");
    if (!s) return;
    s.textContent = window.__lphRunning
      ? `运行中：已打招呼 ${window.__lphDone}/${window.__lphTotal}`
      : `就绪：已打招呼 ${window.__lphDone} / 目标 ${window.__lphTotal}`;
  }

  function buildUI() {
    if (document.getElementById("lph_panel")) return;
    const p = document.createElement("div");
    p.id = "lph_panel";
    p.innerHTML = `
      <div id="lph_bar">
        <span id="lph_title">猎聘海投助手</span>
        <button id="lph_scan" title="扫描职位">扫描</button>
        <button id="lph_run" title="开始">开始</button>
        <button id="lph_stop" title="停止">停止</button>
        <button id="lph_fold" title="折叠">—</button>
      </div>
      <div id="lph_body">
        <div id="lph_stat"></div>
        <div id="lph_log"></div>
      </div>`;
    p.style.cssText =
      "position:fixed;right:14px;bottom:14px;z-index:2147483000;width:340px;background:#fff;" +
      "border:1px solid #d0d7de;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.18);" +
      "font:13px/1.5 system-ui,-apple-system,sans-serif;color:#24292f";

    const bar = $("#lph_bar", p);
    bar.style.cssText =
      "display:flex;align-items:center;gap:4px;padding:8px 10px;background:#f6f8fa;" +
      "border-bottom:1px solid #e1e4e8;border-radius:9px 9px 0 0;cursor:move;user-select:none";
    bar.querySelectorAll("button").forEach((b) => {
      b.style.cssText =
        "border:1px solid #d0d7de;background:#fff;border-radius:6px;padding:3px 9px;" +
        "font:12px system-ui;cursor:pointer;color:#24292f";
    });
    $("#lph_title", bar).style.cssText = "flex:1;font-weight:500";
    $("#lph_stat", p).style.cssText =
      "padding:6px 9px;font-size:12px;color:#57606a;border-bottom:1px solid #f0f0f0";
    $("#lph_log", p).style.cssText = "height:230px;overflow-y:auto";

    document.body.appendChild(p);
    $("#lph_scan", p).onclick = scan;
    $("#lph_run", p).onclick = run;
    $("#lph_stop", p).onclick = stop;
    $("#lph_fold", p).onclick = () => {
      const b = $("#lph_body", p);
      b.style.display = b.style.display === "none" ? "" : "none";
    };
    dragify(p, bar);
  }

  function dragify(panel, handle) {
    let sx, sy, ox, oy, on = false;
    handle.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON") return;
      on = true;
      const r = panel.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!on) return;
      panel.style.left = ox + e.clientX - sx + "px";
      panel.style.top = oy + e.clientY - sy + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    });
    document.addEventListener("mouseup", () => (on = false));
  }

  /* ==================================================================
   * 六、卡片解析 + 猎头判定
   * ================================================================== */
  const CARD = "div.jobCardPcContainer";

  /**
   * 找「聊一聊」按钮。
   * 重要：这个按钮是鼠标 hover 之后才插入 DOM 的，未 hover 时查不到。
   * @param {HTMLElement} card 卡片（可选，不传则全页找）
   */
  function findChatBtn(card) {
    const ROOT = '[data-nick="recruiter-info-box-chat-btn"], .chatBtnBox';

    // 1) 优先在卡片内找
    if (card) {
      const scope = $$(ROOT, card);
      for (const box of scope) {
        const btn = box.querySelector("button") || box;
        const t = txt(btn, 10);
        if (t && t.indexOf("聊") >= 0) return btn;
      }
    }

    // 2) 兜底：全页找一个「可见的」聊一聊按钮
    //    （有些版本会 portal 挂到 body 上，不在卡片里）
    for (const box of $$(ROOT)) {
      const btn = box.querySelector("button") || box;
      const t = txt(btn, 10);
      if (!t || t.indexOf("聊") < 0) continue;
      if (isVisible(btn)) return btn;
    }
    return null;
  }

  function isHeadhunter(card) {
    const t = txt(card, 400);

    for (const tag of HEADHUNTER_TAGS) {
      if (new RegExp(`(^|\\s|\\|)${tag}(\\s|\\||$|，|,|!)`).test(t)) {
        return { hit: true, why: `带「${tag}」标签` };
      }
    }
    const comp = txt(card.querySelector(".companyName"), 40);
    if (comp) {
      for (const kw of HEADHUNTER_COMPANY_KW) {
        if (comp.indexOf(kw) >= 0) return { hit: true, why: `公司名含「${kw}」` };
      }
    }
    const rec = txt(card.querySelector(".recruiter-info-box"), 80);
    if (/猎头|顾问/.test(rec)) return { hit: true, why: "招聘者是猎头顾问" };
    const name = txt(card.querySelector(".jobTitleBox"), 100);
    if (/猎头|外包|劳务派遣/.test(name)) return { hit: true, why: "职位名含猎头/外包" };

    return { hit: false };
  }

  function parseCard(card) {
    const tb = card.querySelector(".jobTitleBox");
    let name = "";
    if (tb) {
      const withTitle = tb.querySelector("[title]");
      name = withTitle
        ? (withTitle.getAttribute("title") || "").trim()
        : txt(tb.querySelector(".ellipsis-1"), 80);
    }
    let loc = "";
    if (tb) {
      const parts = Array.from(tb.querySelectorAll(".ellipsis-1"))
        .map((e) => txt(e, 40)).filter(Boolean);
      loc = (parts[1] || "").replace(/^[【\[]|[】\]]$/g, "").trim();
    }
    const t = txt(card, 400);
    const m = t.match(/(\d+(?:\.\d+)?\s*[-~]\s*\d+\s*[kK][^\s]*(?:·\d+薪)?)/);
    const comp = txt(card.querySelector(".companyName"), 40);
    const hh = isHeadhunter(card);

    return {
      card,
      name: name || "(未知职位)",
      loc,
      salary: m ? m[1] : "",
      comp,
      hh: hh.hit,
      hhWhy: hh.why || "",
      btn: findChatBtn(card),
    };
  }

  function scan() {
    if (!isListPage()) {
      log("当前不是职位列表页", "err");
      return [];
    }
    const cards = $$(CARD);
    if (!cards.length) {
      log("没找到职位卡片（页面可能还没加载完）", "err");
      return [];
    }
    const list = cards.map(parseCard);
    const hh = list.filter((x) => x.hh).length;

    // 注意：「聊一聊」按钮是 hover 之后才插入 DOM 的，
    // 所以这里只按猎头过滤，按钮留到运行时 hover 后再找。
    window.__lphList = list.filter((x) => !x.hh);
    window.__lphTotal = window.__lphList.length;
    window.__lphDone = 0;

    log(
      `扫描 ${list.length} 个职位：排除猎头 ${hh}，待打招呼 ${window.__lphTotal}`,
      "ok"
    );
    // 诊断：打前 3 个被排除的原因，方便确认是不是误判
    const hhList = list.filter((x) => x.hh).slice(0, 3);
    hhList.forEach((x) => log(`  排除：${x.name} —— ${x.hhWhy}`, "warn"));
    updateStat();
    return list;
  }

  /* ==================================================================
   * 七、模拟 hover
   * ================================================================== */
  function hover(el) {
    ["mouseover", "mouseenter", "mousemove", "pointerover", "pointerenter"].forEach((t) => {
      try {
        el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
      } catch (e) {}
    });
  }

  /* ==================================================================
   * 八、聊天窗处理
   * ================================================================== */
  function getChatModal() {
    return $(".ant-im-modal.im-ui-basic-chat-modal") || $(".im-ui-chat-container");
  }

  function closeChat() {
    const c = $('.ant-im-modal span[aria-label="close"], .ant-im-modal .anticon-close');
    if (c) { c.click(); return true; }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true }));
    return false;
  }

  /* ==================================================================
   * 九、主流程
   * ================================================================== */
  function stop() {
    window.__lphRunning = false;
    log("已停止", "warn");
    updateStat();
  }

  async function run() {
    if (window.__lphRunning) { log("已在运行", "warn"); return; }
    if (!isListPage()) { log("请在职位列表页运行", "err"); return; }

    const all = scan();
    if (!all.length) return;
    const targets = window.__lphList;
    if (!targets.length) {
      log("没有可打招呼的职位", "err");
      return;
    }

    window.__lphRunning = true;
    updateStat();
    log(`开始，共 ${targets.length} 个目标`, "ok");

    for (let i = 0; i < targets.length; i++) {
      if (!window.__lphRunning) break;
      if (window.__lphDone >= CONFIG.maxPerSession) {
        log(`达到上限 ${CONFIG.maxPerSession}，停止`, "warn");
        break;
      }

      const job = targets[i];
      const no = i + 1;
      log(`—— [${no}/${targets.length}] ${job.name}${job.comp ? " @ " + job.comp : ""}`);

      try { job.card.scrollIntoView({ block: "center" }); } catch (e) {}
      await sleep(300);

      hover(job.card);
      hover(job.card.querySelector(".recruiter-info-box") || job.card);
      hover(job.card.querySelector(".jobCardRightBox") || job.card);
      await sleep(500);

      // hover 之后按钮才插入 DOM，所以每次都要重新找
      let btn = findChatBtn(job.card);
      if (!btn) {
        log("  跳过：找不到「聊一聊」按钮", "err");
        await sleep(CONFIG.interval);
        continue;
      }
      const bt = txt(btn, 10);
      if (bt && AVOID_BTN.some((a) => bt.indexOf(a) >= 0)) {
        log(`  跳过：按钮是「${bt}」`, "err");
        continue;
      }

      btn.click();

      const modal = await waitFor(() => {
        const m = getChatModal();
        return m && isVisible(m) ? m : null;
      }, CONFIG.waitChatWindow);

      if (!modal) {
        log("  未弹出聊天窗（可能已达上限或已打过招呼）", "warn");
        await sleep(CONFIG.interval);
        continue;
      }

      log("  聊天窗已打开，猎聘自动发送招呼语");
      await sleep(800);

      await sleep(600);
      if (!closeChat()) log("  聊天窗关闭失败，继续", "warn");
      await sleep(800);

      job.btn = null;
      window.__lphDone++;
      log(`  完成（${window.__lphDone}/${window.__lphTotal}）`, "ok");
      updateStat();

      await sleep(CONFIG.interval);
    }

    window.__lphRunning = false;
    log(`全部结束，共完成 ${window.__lphDone} 个`, "ok");
    updateStat();
  }

  /* ==================================================================
   * 十、启动
   * ================================================================== */
  function boot() {
    buildUI();
    window.__lphDone = window.__lphDone || 0;
    window.__lphTotal = window.__lphTotal || 0;
    updateStat();
    if (isListPage()) {
      log("已就绪。先在页面上筛选好，再点「扫描」→「开始」");
      setTimeout(scan, 1000);
    } else {
      log("请在猎聘职位列表页使用（/zhaopin/）");
    }
  }

  window.addEventListener("load", boot);
  if (document.readyState === "complete") boot();
})();
