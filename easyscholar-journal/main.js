/* ==========================================================================
 * easyScholar 期刊信息插件（示例插件）
 * --------------------------------------------------------------------------
 * 挂载点：literature-enhancer（文献详情增强）
 * 逻辑：
 *   1. 监听文献详情渲染（onRender 钩子）；
 *   2. 取当前文献的期刊名（journal）；
 *   3. 先查本地缓存（插件目录 cache.json），命中直接显示；
 *   4. 未命中则调用 easyScholar API（经宿主 httpGet 代理，避免 CORS）；
 *   5. 解析返回的 officialRank / customRank，新结果写入本地缓存；
 *   6. 默认显示中科院分区（sciUp）、影响因子（sciif）、SCI 分区（sci）、是否 Top（sciUpTop），
 *      其余折叠到「更多…」小弹窗。
 * 说明：插件适配软件，仅通过受限的 SgelinPlugin 桥接对象访问能力，不直接操作 DOM。
 * ========================================================================== */
(function (SgelinPlugin) {
  "use strict";

  var API = "https://www.easyscholar.cc/open/getPublicationRank";

  // 默认优先显示的字段（按顺序）：中科院升级版分区 / 影响因子 / SCI分区 / 是否Top
  var DEFAULT_KEYS = ["sciUp", "sciif", "sci", "sciUpTop"];

  // 字段缩写 → 中文标签（用于显示）
  var LABELS = {
    "sciUp": "中科院分区",
    "sciif": "影响因子",
    "sci": "SCI分区",
    "sciUpTop": "Top",
    "sciBase": "中科院基础版",
    "sciUpSmall": "中科院小类",
    "sciif5": "五年影响因子",
    "jci": "JCI",
    "ssci": "SSCI",
    "eii": "EI",
    "esi": "ESI",
    "cscd": "CSCD",
    "cssci": "CSSCI",
    "pku": "北大核心",
    "ajg": "ABS",
    "ft50": "FT50",
    "utd24": "UTD24",
    "ccf": "CCF",
    "sciwarn": "中科院预警"
  };

  // 内存缓存（本次会话内避免重复请求）
  var memCache = {};
  // 本地持久化缓存文件名（插件自行维护，存于插件数据目录）
  var CACHE_FILE = "cache.json";
  // 本地缓存是否已加载（避免重复读文件）
  var diskCacheLoaded = false;
  var diskCache = {};

  function labelOf(key) {
    return LABELS[key] || key.toUpperCase();
  }

  // 从插件数据目录加载本地缓存（插件自行实现持久化，不依赖主程序定制接口）
  function loadDiskCache() {
    if (diskCacheLoaded) return Promise.resolve(diskCache);
    return SgelinPlugin.readFile(CACHE_FILE).then(function (res) {
      diskCacheLoaded = true;
      if (res && res.ok && res.exists && res.content) {
        try { diskCache = JSON.parse(res.content) || {}; } catch (e) { diskCache = {}; }
      }
      return diskCache;
    }).catch(function () {
      diskCacheLoaded = true;
      return diskCache;
    });
  }

  // 把本地缓存写回插件数据目录
  function saveDiskCache() {
    return SgelinPlugin.writeFile(CACHE_FILE, JSON.stringify(diskCache));
  }

  // 解析 easyScholar 返回结果，得到 [{key, label, rank}, ...]
  function parseRanks(data) {
    var items = [];
    if (!data) return items;

    // officialRank.all：官方数据集（缩写 → 等级）
    var official = data.officialRank && data.officialRank.all;
    if (official) {
      Object.keys(official).forEach(function (key) {
        items.push({ key: key, label: labelOf(key), rank: String(official[key]) });
      });
    }

    // customRank：自定义数据集（rankInfo 缩写 + rank 等级）
    var custom = data.customRank;
    if (custom) {
      var rankInfo = custom.rankInfo || [];
      var rankList = custom.rank || [];
      rankList.forEach(function (r) {
        var parts = String(r).split("&&&");
        if (parts.length < 2) return;
        var uuid = parts[0];
        var level = parseInt(parts[1], 10);   // 1~5
        var info = null;
        for (var i = 0; i < rankInfo.length; i++) {
          if (rankInfo[i].uuid === uuid) { info = rankInfo[i]; break; }
        }
        if (!info) return;
        var rankText = "";
        if (level === 1) rankText = info.oneRankText || "";
        else if (level === 2) rankText = info.twoRankText || "";
        else if (level === 3) rankText = info.threeRankText || "";
        else if (level === 4) rankText = info.fourRankText || "";
        else if (level === 5) rankText = info.fiveRankText || "";
        items.push({ key: "custom:" + (info.abbName || uuid), label: info.abbName || uuid, rank: rankText });
      });
    }
    return items;
  }

  // 按默认字段优先排序：DEFAULT_KEYS 中的字段排前面，其余按原顺序
  function sortItems(items) {
    var order = {};
    DEFAULT_KEYS.forEach(function (k, i) { order[k] = i; });
    return items.slice().sort(function (a, b) {
      var oa = order.hasOwnProperty(a.key) ? order[a.key] : 999;
      var ob = order.hasOwnProperty(b.key) ? order[b.key] : 999;
      return oa - ob;
    });
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // 生成 badge HTML：前 maxVisible 项直接显示，其余折叠到「更多…」
  function buildBadgeHtml(items, maxVisible) {
    if (!items.length) return "";
    var visible = items.slice(0, maxVisible);
    var hidden = items.slice(maxVisible);

    var html = visible.map(function (it) {
      return '<span class="plugin-rank-badge">' + esc(it.label) + ' <span class="rk">' + esc(it.rank) + '</span></span>';
    }).join("");

    if (hidden.length) {
      html += '<button class="plugin-more-btn">更多…</button>';
      html += '<div class="plugin-more-pop" style="display:none">' +
        hidden.map(function (it) {
          return '<div>' + esc(it.label) + ' <span class="rk">' + esc(it.rank) + '</span></div>';
        }).join("") +
        '</div>';
    }
    return html;
  }

  // 渲染钩子：每次切换文献时调用
  SgelinPlugin.onRender(function () {
    var paper = SgelinPlugin.getCurrentPaper();
    if (!paper || !paper.journal) {
      SgelinPlugin.setDetailBadge("");
      return;
    }
    var journal = paper.journal;
    var cfg = SgelinPlugin.getConfig();
    var maxVisible = parseInt(cfg.maxVisible, 10);
    if (isNaN(maxVisible) || maxVisible < 1) maxVisible = 4;

    // 1. 内存缓存命中
    if (memCache[journal]) {
      SgelinPlugin.setDetailBadge(buildBadgeHtml(memCache[journal], maxVisible));
      return;
    }

    // 2. 本地持久化缓存命中（插件自行维护 cache.json）
    loadDiskCache().then(function (cache) {
      if (cache && cache[journal]) {
        var items = cache[journal];
        memCache[journal] = items;
        SgelinPlugin.setDetailBadge(buildBadgeHtml(items, maxVisible));
        return;
      }

      // 3. 未命中 → 调 API
      var secretKey = cfg.secretKey || "";
      if (!secretKey) {
        SgelinPlugin.setDetailBadge('<span class="plugin-rank-badge" style="opacity:.6">easyScholar：未配置 SecretKey</span>');
        return;
      }

      var url = API + "?secretKey=" + encodeURIComponent(secretKey) + "&publicationName=" + encodeURIComponent(journal);
      SgelinPlugin.httpGet(url).then(function (res) {
        if (!res.ok) {
          SgelinPlugin.setDetailBadge('<span class="plugin-rank-badge" style="opacity:.6">easyScholar：查询失败</span>');
          return;
        }
        var json;
        try { json = JSON.parse(res.body); } catch (e) {
          SgelinPlugin.setDetailBadge('<span class="plugin-rank-badge" style="opacity:.6">easyScholar：返回解析失败</span>');
          return;
        }
        if (json.code !== 200 || !json.data) {
          SgelinPlugin.setDetailBadge('<span class="plugin-rank-badge" style="opacity:.6">easyScholar：' + esc(json.msg || "无数据") + '</span>');
          return;
        }
        var items = sortItems(parseRanks(json.data));
        memCache[journal] = items;
        // 新结果入库（插件自行持久化到 cache.json）
        diskCache[journal] = items;
        saveDiskCache();
        SgelinPlugin.setDetailBadge(buildBadgeHtml(items, maxVisible));
      }).catch(function () {
        SgelinPlugin.setDetailBadge('<span class="plugin-rank-badge" style="opacity:.6">easyScholar：网络错误</span>');
      });
    });
  });
  // 配置界面由插件自己显示（打开插件详情时，宿主调用本渲染函数）
  SgelinPlugin.setConfigRenderer(function (container, api) {
    var cfg = api.getConfig() || {};
    container.innerHTML =
      '<div class="plugin-field">' +
      '  <label>easyScholar SecretKey</label>' +
      '  <input type="password" id="esSecretKey" value="' + esc(cfg.secretKey || "") + '" placeholder="在 easyScholar 官网获取的 SecretKey">' +
      '</div>' +
      '<div class="plugin-field">' +
      '  <label>直接显示的等级项数量（其余折叠到「更多…」）</label>' +
      '  <input type="number" id="esMaxVisible" value="' + esc(cfg.maxVisible || "4") + '" placeholder="如 4">' +
      '</div>' +
      '<div class="plugin-config-tip">SecretKey 仅保存在本机插件目录（DPAPI 加密），不会上传到互联网或 git 仓库。</div>' +
      '<button class="plugin-btn primary" id="esSaveBtn">保存</button>' +
      '<span class="plugin-config-status" id="esConfigStatus"></span>';

    document.getElementById("esSaveBtn").addEventListener("click", function () {
      var values = {
        secretKey: document.getElementById("esSecretKey").value,
        maxVisible: document.getElementById("esMaxVisible").value || "4"
      };
      var status = document.getElementById("esConfigStatus");
      api.saveConfig(values).then(function (res) {
        if (res && res.ok) {
          status.textContent = "✅ 已保存";
          status.style.color = "#10b981";
          api.refresh();
        } else {
          status.textContent = "❌ " + (res && res.error ? res.error : "保存失败");
          status.style.color = "#ef4444";
        }
      }).catch(function () {
        var s = document.getElementById("esConfigStatus");
        s.textContent = "❌ 保存失败";
        s.style.color = "#ef4444";
      });
    });
  });
})(SgelinPlugin);
