/* ==========================================================================
 * MinerU PDF 解析插件（mineru-markdown） v2.0.0
 * --------------------------------------------------------------------------
 * 定位：为「AI 阅读 / 精读」提供 PDF → Markdown 的解析工具与缓存（宿主不改时，
 *       插件把 md 按文献缓存到插件数据目录，供未来 RaA/AI 读取；本轮先落盘）。
 *
 * 工作流（受桥接限制：宿主仅提供 GET httpGet、无 POST/上传、前端读不到本地 PDF）：
 *   · Agent 轻量（免 token）：插件可自动【查询进度】并【下载 md 落盘】；
 *     「提交解析」这一步（POST）需在外部完成，插件提供可复制的命令与 task_id 绑定。
 *   · 精准 API（需 Token、公式/表格识别）：查询须带 Authorization 头、结果为 zip，
 *     前端无法自动轮询/解压 → 插件提供可复制的提交命令 + 把 zip 内 full.md 手动导入缓存。
 *
 * 能力：
 *   1) 按文献缓存 md（markdown/<file>.md + cache.json 索引）
 *   2) Agent 任务绑定 → 自动轮询 → 自动下载 md 缓存
 *   3) 精准/任意来源 md 手动导入缓存（覆盖公式精读的 full.md）
 *   4) 缓存管理：自动清理间隔（天）、一键清理、单条删除、徽章提示
 *   5) 配置界面由插件自渲染（token / model / 公式 / 清理 / 轮询）
 * ========================================================================== */
(function (SgelinPlugin) {
  "use strict";

  var MD_DIR = "markdown/";                       // md 缓存子目录（相对插件数据目录）
  var CACHE_FILE = "cache.json";                  // 缓存索引（key → 元数据）
  var AGENT_QUERY = "https://mineru.net/api/v1/agent/parse/";
  var PRECISE_TASK = "https://mineru.net/api/v4/extract/task";

  var ACTIVE = { "waiting-file": 1, uploading: 1, pending: 1, running: 1 };
  var STATE_TEXT = {
    "waiting-file": "等待文件上传", uploading: "上传中", pending: "排队中",
    running: "解析中", done: "完成", failed: "失败", converting: "转换中"
  };

  var cfg = {};        // 配置快照（token/model/formula/cleanupDays/pollInterval）
  var cache = {};      // cache.json 内容：key → {title,mdFile,mode,source,taskId,state,saved,err,updatedAt}
  var cacheLoaded = false;
  var pollTimer = null;
  var inFlight = {};   // agent 单任务查询进行中标记

  /* ---------------- 基础工具 ---------------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function safeName(s) {
    var name = String(s || "").replace(/[\\/:*?"<>|\r\n]+/g, "_").replace(/\s+/g, " ").trim();
    if (name.length > 60) name = name.slice(0, 60);
    return name || "untitled";
  }
  function nowIso() { return new Date().toISOString(); }
  function shortHash(s) {
    var h = 0, str = String(s);
    for (var i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36).slice(0, 8) || "0";
  }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function fmtTime(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
        " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
    } catch (e) { return iso; }
  }
  function refreshCfg() { cfg = SgelinPlugin.getConfig() || {}; }
  function paper() { return SgelinPlugin.getCurrentPaper(); }
  function currentKey() {
    var p = paper();
    if (!p) return null;
    return String(p.topic || "-") + "/" + String(p.id || p.paperId || p.title || "-");
  }

  /* ---------------- cache.json 索引 ---------------- */
  function loadCache() {
    if (cacheLoaded) return Promise.resolve(cache);
    return SgelinPlugin.readFile(CACHE_FILE).then(function (res) {
      cacheLoaded = true;
      if (res && res.ok && res.exists && res.content) {
        try { cache = JSON.parse(res.content) || {}; } catch (e) { cache = {}; }
      }
      return cache;
    }).catch(function () { cacheLoaded = true; return cache; });
  }
  function saveCache() { return SgelinPlugin.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2)); }

  function getRec(key) { return cache[key] || null; }

  // 把一段 md 文本落盘到缓存并登记索引
  function cacheMd(key, title, text, meta) {
    var rec = getRec(key) || {};
    var file = rec.mdFile || (MD_DIR + safeName(title || key) + "_" + shortHash(key) + ".md");
    // sourceFile = 对应 PDF 文件名（宿主 RaA 按此命中缓存；RaA 阶段 key 为 "raa/<文件名>"）
    var pp = paper();
    var pdfName = "";
    if (pp && pp.pdf) pdfName = String(pp.pdf).split(/[\\/]/).pop() || "";
    return SgelinPlugin.writeFile(file, text || "").then(function (w) {
      if (!w || !w.ok) return { ok: false, error: (w && w.error) || "写入 md 失败" };
      cache[key] = {
        title: title || key,
        mdFile: file,
        mode: meta.mode || "import",          // agent | precise | import
        source: meta.source || "manual",
        sourceFile: meta.sourceFile || pdfName || "",
        taskId: meta.taskId || "",
        modelVersion: meta.modelVersion || "",
        state: meta.state || "done",
        saved: true,
        updatedAt: nowIso()
      };
      return saveCache().then(function () { return { ok: true, file: file }; });
    });
  }

  // 清掉某条缓存（索引移除 + md 置空释放内容；宿主暂无删文件桥接）
  function evictKey(key) {
    var rec = getRec(key);
    var empty = Promise.resolve({ ok: true });
    if (rec && rec.mdFile) empty = SgelinPlugin.writeFile(rec.mdFile, "").catch(function () { return { ok: false }; });
    delete cache[key];
    return empty.then(function () { return saveCache(); });
  }

  // 自动清理：超过 cleanupDays 天未更新的缓存（0 = 不自动清理）
  function autoCleanup() {
    refreshCfg();
    var days = parseInt(cfg.cleanupDays, 10);
    if (isNaN(days) || days <= 0) return Promise.resolve();
    var limit = days * 86400000, now = Date.now();
    var stale = Object.keys(cache).filter(function (k) {
      var t = new Date((cache[k] && cache[k].updatedAt) || 0).getTime();
      return (now - t) > limit;
    });
    if (!stale.length) return Promise.resolve();
    var chain = Promise.resolve();
    stale.forEach(function (k) { chain = chain.then(function () { return evictKey(k); }); });
    return chain;
  }

  /* ---------------- Agent 轻量：自动轮询并下载 md ---------------- */
  function pollAgent(key) {
    var rec = getRec(key);
    if (!rec || rec.mode !== "agent" || !rec.taskId || inFlight[key]) return Promise.resolve();
    inFlight[key] = true;
    return SgelinPlugin.httpGet(AGENT_QUERY + encodeURIComponent(rec.taskId)).then(function (res) {
      delete inFlight[key];
      if (!res || !res.ok) { renderBadge(); return; }
      var d;
      try { d = (JSON.parse(res.body) || {}).data; } catch (e) { d = null; }
      if (!d) { renderBadge(); return; }
      rec.state = d.state || rec.state || "";
      if (d.markdown_url) rec.markdownUrl = d.markdown_url;
      if (d.state === "failed") rec.err = d.err_msg || ("错误码 " + (d.err_code || ""));
      else rec.err = "";
      rec.updatedAt = nowIso();
      saveCache();
      renderBadge();
      if (rec.state === "done" && rec.markdownUrl && !rec.saved) downloadAgentMd(key, rec);
    }).catch(function () { delete inFlight[key]; renderBadge(); });
  }

  function downloadAgentMd(key, rec) {
    SgelinPlugin.httpGet(rec.markdownUrl).then(function (res) {
      if (!res || !res.ok || res.body == null) return;   // 下一轮重试
      return cacheMd(key, rec.title, res.body, {
        mode: "agent", source: "auto", taskId: rec.taskId, modelVersion: "pipeline(agent)"
      }).then(function () { renderBadge(); });
    }).catch(function () { /* 下一轮重试 */ });
  }

  function pollIntervalSec() {
    var sec = parseInt(cfg.pollInterval, 10);
    if (isNaN(sec) || sec < 5) sec = 10;
    return sec;
  }
  // 仅当当前文献有进行中的 agent 任务时轮询（避免无头空转）
  function syncPolling() {
    var key = currentKey();
    var rec = key ? getRec(key) : null;
    var active = rec && rec.mode === "agent" && rec.taskId &&
      (!rec.state || ACTIVE[rec.state] || (rec.state === "done" && rec.markdownUrl && !rec.saved));
    if (!active) { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } return; }
    if (!pollTimer) pollTimer = setInterval(function () { pollAgent(key); }, pollIntervalSec() * 1000);
    pollAgent(key);
  }

  /* ---------------- 详情徽章 ---------------- */
  function renderBadge() {
    var key = currentKey();
    var rec = key ? getRec(key) : null;
    var html = "";
    if (rec) {
      if (rec.state === "done" && !rec.saved) {
        html = '<span class="plugin-rank-badge">📄 MinerU <span class="rk">解析完成，保存中…</span></span>';
      } else if (rec.state && ACTIVE[rec.state]) {
        html = '<span class="plugin-rank-badge">📄 MinerU <span class="rk">' + esc(STATE_TEXT[rec.state] || rec.state) + '…</span></span>';
      } else if (rec.state === "failed") {
        html = '<span class="plugin-rank-badge" style="opacity:.8">❌ MinerU 失败：' + esc(rec.err || "未知") + '</span>';
      } else if (rec.mdFile && rec.saved) {
        var modeText = rec.mode === "agent" ? "Agent自动" : (rec.mode === "precise" ? "精准解析" : "手动导入");
        html = '<span class="plugin-rank-badge">📄 <span class="rk">md缓存</span> ' + modeText + ' · ' + fmtTime(rec.updatedAt) + '</span>';
      }
    }
    SgelinPlugin.setDetailBadge(html);
  }

  SgelinPlugin.onRender(function () {
    refreshCfg();
    loadCache().then(function () { renderBadge(); syncPolling(); });
  });

  /* ---------------- 生成可复制的提交命令 ---------------- */
  function buildCurl(mode, url, c) {
    if (mode === "agent") {
      return 'curl -X POST https://mineru.net/api/v1/agent/parse/url \\\n' +
        '  -H "Content-Type: application/json" \\\n' +
        '  -d \'{"url":"' + String(url || "").trim() + '","language":"ch"}\'';
    }
    var model = String(c.modelVersion || "vlm").trim() || "vlm";
    var formula = String(c.enableFormula || "true").trim() !== "false";
    var token = String(c.token || "").trim();
    var authLine = token ? '  -H "Authorization: Bearer ' + token + '" \\\n' : "";
    return 'curl -X POST ' + PRECISE_TASK + ' \\\n' + authLine +
      '  -H "Content-Type: application/json" \\\n' +
      '  -d \'{"url":"' + String(url || "").trim() + '","model_version":"' + model +
      '","enable_formula":' + formula + ',"enable_table":true,"language":"ch"}\'';
  }

  // 选择本地 md 文件并导入到当前文献缓存（精准 full.md / 任意 md）
  function pickMd() {
    var key = currentKey(), p = paper();
    if (!key || !p) return;
    var input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,text/markdown";
    input.onchange = function () {
      var f = input.files && input.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        cacheMd(key, p.title, String(reader.result || ""), { mode: "import", source: "file" }).then(function (r) {
          var el = document.getElementById("muStatus");
          if (r && r.ok) { if (el) { el.textContent = "✅ 已导入并缓存"; el.style.color = "#10b981"; } }
          else if (el) { el.textContent = "❌ 导入失败"; el.style.color = "#ef4444"; }
          renderBadge();
        });
      };
      reader.readAsText(f, "utf-8");
    };
    input.click();
  }

  /* ---------------- 配置界面（插件自渲染） ---------------- */
  SgelinPlugin.setConfigRenderer(function (container, api) {
    refreshCfg();
    loadCache().then(autoCleanup).then(function () {
      var key = currentKey();
      var p = paper();
      var rec = key ? getRec(key) : null;
      var cfgNow = (api.getConfig && api.getConfig()) || cfg;

      // 状态提示辅助（针对本条缓存操作的 muStatus）
      var H = [];
      function tip(html) { H.push(html); }

      // —— 当前文献 ——
      tip('<div class="plugin-config-tip" style="font-weight:600;font-size:13px">📄 ' +
        (p ? esc(p.title || key) : "未打开文献详情（先选中一篇文献）") + '</div>');

      if (rec && rec.mdFile && rec.saved) {
        var m1 = rec.mode === "agent" ? "Agent 自动" : (rec.mode === "precise" ? "精准解析" : "手动导入");
        tip('<div style="background:var(--accent-bg);padding:8px 10px;border-radius:8px;font-size:12px;margin-bottom:8px">' +
          '✅ 已有缓存：<b>' + esc(m1) + '</b> · ' + fmtTime(rec.updatedAt) +
          '<br><span style="opacity:.6">' + esc(rec.mdFile) + '</span></div>');
      } else {
        tip('<div class="plugin-config-tip">当前文献暂无 md 缓存，可用下方任一方式解析后缓存。</div>');
      }

      // ① Agent
      tip('<div style="margin:14px 0 6px;padding-top:10px;border-top:1px solid var(--border);font-size:12px;font-weight:700;color:var(--muted)">① Agent 轻量解析（免 token · ≤10MB / ≤20页）</div>');
      tip('<div class="plugin-field"><label>文件 URL 或 task_id</label>' +
        '<input type="text" id="muUrl" placeholder="https://…/paper.pdf 或已提交任务的 task_id" value="' +
        esc(rec && (rec.taskId || "")) + '"></div>');
      tip('<pre id="muAgentCurl" style="display:none;white-space:pre-wrap;word-break:break-all;background:var(--input-bg);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:11px;line-height:1.6;color:var(--text);cursor:pointer;margin:0 0 8px"></pre>');
      tip('<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
        '<button class="plugin-btn" id="muGenAgent">生成提交命令</button>' +
        '<button class="plugin-btn primary" id="muBindAgent">绑定并自动轮询</button>' +
        '</div>');
      tip('<div class="plugin-config-tip" style="font-size:11px">① 点击「生成提交命令」→ 在外部终端执行，返回 JSON 的 <code>data.task_id</code>；' +
        '② 把 task_id 填入上框 → 「绑定并自动轮询」，插件会自动下载 md 并缓存。</div>');

      // ② 精准
      tip('<div style="margin:14px 0 6px;padding-top:10px;border-top:1px solid var(--border);font-size:12px;font-weight:700;color:var(--muted)">② 精准解析（API Token · 公式/表格 · ≤200MB / ≤200页）</div>');
      tip('<div class="plugin-field"><label>文件 URL（精准接口不支持直接上传本地文件）</label>' +
        '<input type="text" id="muPUrl" placeholder="https://…/paper.pdf"></div>');
      tip('<pre id="muPreciseCurl" style="display:none;white-space:pre-wrap;word-break:break-all;background:var(--input-bg);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:11px;line-height:1.6;color:var(--text);cursor:pointer;margin:0 0 8px"></pre>');
      tip('<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
        '<button class="plugin-btn" id="muGenPrecise">生成精准提交命令</button>' +
        '</div>');
      tip('<div class="plugin-config-tip" style="font-size:11px">精准结果返回 <b>zip</b>（内含 <code>full.md</code>），查询需 Authorization 头、结果需解压，' +
        '前端无法自动完成：请在外部执行命令并下载 zip，用下方「③ 导入」把 <code>full.md</code> 缓存到本文献。</div>');

      // ③ 导入
      tip('<div style="margin:14px 0 6px;padding-top:10px;border-top:1px solid var(--border);font-size:12px;font-weight:700;color:var(--muted)">③ 导入 md 到当前文献缓存</div>');
      tip('<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
        '<button class="plugin-btn" id="muImportBtn">📥 选择 .md 导入</button>' +
        (rec && rec.mdFile && rec.saved ? '<button class="plugin-btn danger" id="muEvictBtn">删除当前缓存</button>' : '') +
        '<span class="plugin-config-status" id="muStatus"></span></div>');

      // —— 缓存管理 ——
      var ks = Object.keys(cache);
      tip('<div style="margin:14px 0 6px;padding-top:10px;border-top:1px solid var(--border);font-size:12px;font-weight:700;color:var(--muted)">🗂 缓存管理（共 ' + ks.length + ' 篇）</div>');
      tip('<div id="muCacheList" style="margin-bottom:6px">' +
        (ks.length ? "" : '<div style="opacity:.6;font-size:12px">暂无缓存。</div>') + '</div>');
      tip('<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
        '<button class="plugin-btn danger" id="muCleanAll">🧹 一键清理全部缓存</button>' +
        '<button class="plugin-btn" id="muCleanNow">自动清理（按设置天数）</button>' +
        '</div>');

      // —— 全局设置 ——
      tip('<div style="margin:14px 0 6px;padding-top:10px;border-top:1px solid var(--border);font-size:12px;font-weight:700;color:var(--muted)">⚙️ MinerU 设置</div>');
      tip('<div class="plugin-field"><label>精准解析 Token（API 管理页创建）</label>' +
        '<input type="password" id="muToken" value="' + esc(cfgNow.token || "") + '" placeholder="Bearer 后的 Token"></div>');
      tip('<div class="plugin-field"><label>精准模型版本（pipeline / vlm / MinerU-HTML）</label>' +
        '<input type="text" id="muModel" value="' + esc(cfgNow.modelVersion || "vlm") + '"></div>');
      tip('<div class="plugin-field"><label>精准公式识别 enable_formula（true / false）</label>' +
        '<input type="text" id="muFormula" value="' + esc(cfgNow.enableFormula || "true") + '"></div>');
      tip('<div class="plugin-field"><label>缓存自动清理间隔（天，0=不自动）</label>' +
        '<input type="number" id="muCleanupDays" value="' + esc(cfgNow.cleanupDays || "30") + '" min="0"></div>');
      tip('<div class="plugin-field"><label>Agent 轮询间隔（秒，最小 5）</label>' +
        '<input type="number" id="muPoll" value="' + esc(cfgNow.pollInterval || "10") + '" min="5"></div>');
      tip('<div><button class="plugin-btn primary" id="muSaveCfg">💾 保存设置</button>' +
        '<span class="plugin-config-status" id="muCfgStatus"></span></div>');

      container.innerHTML = H.join("");

      // —— 渲染缓存列表 ——
      var listEl = document.getElementById("muCacheList");
      if (ks.length) {
        listEl.innerHTML = ks.map(function (k) {
          var c = cache[k];
          var md = c.mode === "agent" ? "Agent" : (c.mode === "precise" ? "精准" : "导入");
          var hot = key === k;
          return '<div style="display:flex;gap:8px;align-items:center;padding:6px 8px;margin-bottom:6px;border:1px solid ' + (hot ? 'var(--primary)' : 'var(--border)') + ';border-radius:8px;background:var(--bg)">' +
            '<div style="flex:1;min-width:0">' +
            '<div style="font-size:12px;font-weight:600;color:var(--text)">' + esc(c.title || k) +
            (hot ? ' <span style="color:#10b981">(当前)</span>' : '') + '</div>' +
            '<div style="font-size:11px;opacity:.7">[' + md + '] ' + fmtTime(c.updatedAt) + ' · ' + esc(c.mdFile || "") + '</div>' +
            '</div>' +
            '<button class="plugin-btn danger" style="padding:2px 8px;font-size:11px" data-del="' + esc(k) + '">删</button>' +
            '</div>';
        }).join("");
        listEl.querySelectorAll("button[data-del]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var k = btn.getAttribute("data-del");
            if (!confirm("删除缓存「" + ((cache[k] && cache[k].title) || k) + "」？")) return;
            evictKey(k).then(function () {
              var st = document.getElementById("muStatus");
              if (st) { st.textContent = "已删除"; st.style.color = "#10b981"; }
            });
          });
        });
      }

      var status = function (msg, ok) {
        var el = document.getElementById("muStatus");
        if (el) { el.textContent = msg; el.style.color = ok ? "#10b981" : "#ef4444"; }
      };
      function putCurl(id, text) {
        var el = document.getElementById(id);
        el.textContent = text; el.style.display = "block";
        el.onclick = function () {
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
          status("命令已复制，请粘贴到外部终端执行", true);
        };
      }

      document.getElementById("muGenAgent").addEventListener("click", function () {
        var url = document.getElementById("muUrl").value.trim();
        if (!url) { status("请先填写文件 URL", false); return; }
        putCurl("muAgentCurl", buildCurl("agent", url, cfgNow));
      });
      document.getElementById("muGenPrecise").addEventListener("click", function () {
        var url = document.getElementById("muPUrl").value.trim();
        if (!url) { status("请先填写文件 URL", false); return; }
        if (!cfgNow.token) status("提示：尚未配置 Token，请先在下方 ⚙️ 设置填写并保存", false);
        putCurl("muPreciseCurl", buildCurl("precise", url, cfgNow));
        if (cfgNow.token) status("命令已生成（点击可复制）", true);
      });
      document.getElementById("muBindAgent").addEventListener("click", function () {
        var v = document.getElementById("muUrl").value.trim();
        if (!key || !p) { status("未选中文献，无法绑定", false); return; }
        if (!v) { status("请填 URL 或 task_id", false); return; }
        var looksTask = /^[0-9a-fA-F-]{8,}$/.test(v);
        if (!looksTask) {
          status("看起来是 URL：请先用「生成提交命令」在外部提交，再把返回的 task_id 粘贴此处", false);
          return;
        }
        cache[key] = {
          title: p.title || key, mdFile: "", state: "", saved: false, err: "",
          taskId: v, mode: "agent", source: "url", modelVersion: "pipeline(agent)", updatedAt: nowIso()
        };
        saveCache().then(function () { status("已绑定，开始自动轮询…", true); syncPolling(); });
      });

      var importBtn = document.getElementById("muImportBtn");
      if (importBtn) importBtn.addEventListener("click", pickMd);
      var evictBtn = document.getElementById("muEvictBtn");
      if (evictBtn) evictBtn.addEventListener("click", function () {
        if (!key) return;
        if (!confirm("删除当前文献的 md 缓存？")) return;
        evictKey(key).then(function () { status("已删除当前缓存", true); renderBadge(); });
      });
      document.getElementById("muCleanAll").addEventListener("click", function () {
        var total = Object.keys(cache).length;
        if (!total) { status("当前没有缓存", true); return; }
        if (!confirm("确定一键清理全部缓存（" + total + " 篇）？")) return;
        var chain = Promise.resolve();
        Object.keys(cache).forEach(function (k) { chain = chain.then(function () { return evictKey(k); }); });
        chain.then(function () { status("已清理全部缓存", true); renderBadge(); });
      });
      document.getElementById("muCleanNow").addEventListener("click", function () {
        autoCleanup().then(function () { status("自动清理完成（保留最近 " + (cfgNow.cleanupDays || 30) + " 天）", true); });
      });
      document.getElementById("muSaveCfg").addEventListener("click", function () {
        var values = {
          token: document.getElementById("muToken").value,
          modelVersion: document.getElementById("muModel").value.trim() || "vlm",
          enableFormula: document.getElementById("muFormula").value.trim() || "true",
          cleanupDays: document.getElementById("muCleanupDays").value || "30",
          pollInterval: document.getElementById("muPoll").value || "10"
        };
        api.saveConfig(values).then(function (res) {
          var el = document.getElementById("muCfgStatus");
          if (res && res.ok) {
            if (el) { el.textContent = "✅ 已保存"; el.style.color = "#10b981"; }
            cfg = values;
          } else if (el) { el.textContent = "❌ " + ((res && res.error) || "保存失败"); el.style.color = "#ef4444"; }
        });
      });
    });
  });

  /* ---------------- 启动 ---------------- */
  refreshCfg();
  loadCache().then(function () { renderBadge(); syncPolling(); });
})(SgelinPlugin);
