/* ============================================================
 * core/savetree.js —— 存档树（纯逻辑，不碰 DOM、不碰存储）
 *
 * 思路来自 KaiTuoYiShi 的「存档树」：
 *   一个开局 = 一棵树。每一轮结束自动存一个**节点**，手动存档也是节点。
 *   每个节点记着它的父节点。读一个旧节点接着玩，新节点就挂在它下面 ——
 *   于是自然长出**分支**，原来那条线不会被覆盖，随时能回去。
 *
 * 槽位（GalStore 里的 id）：
 *   node:<nodeId>   树上的节点（type = auto | manual，导入的带 imported）
 *   auto:<runId>    这个开局的「最新进度」指针，给「继续上次」用；
 *                   树里已经有节点时它不单独显示（内容和最新节点一样）
 *   其它名字         老版本留下的手动存档，按 runId 归到对应的树，没有 runId 的单独成树
 * ============================================================ */
(function (global) {
  'use strict';

  var AUTO_KEEP = 8;          // 每棵树保留的自动节点数（手动节点不限）

  function newId(prefix) {
    return (prefix || 'n') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function isPointer(id) { return id === 'auto' || String(id).indexOf('auto:') === 0; }
  function isNode(id) { return String(id).indexOf('node:') === 0; }

  function roundsOf(history) {
    return (history || []).filter(function (m) { return m && m.role === 'user' && !m.phoneOnly; }).length;
  }

  /** 最后一句台词，列表里当摘要。『地点 · 时间』那种抬头不算（每轮第一句都是它，看不出区别） */
  function summaryOf(v) {
    var log = (v && v.log) || [];
    var m = null;
    for (var i = log.length - 1; i >= 0 && !m; i--) {
      if (log[i] && !/^\s*『[^』]*』\s*$/.test(String(log[i].text || ''))) m = log[i];
    }
    if (!m) m = log[log.length - 1];
    if (!m) return '';
    var t = String(m.text || '').replace(/\s+/g, ' ').trim();
    return ((m.narration || !m.who) ? '' : m.who + '：') + (t.length > 60 ? t.slice(0, 60) + '…' : t);
  }

  /** 从一份完整存档算出列表要用的摘要（存进目录索引，打开列表不用再整份读） */
  function summarize(id, v) {
    v = v || {};
    var tree = v.tree || {};
    var type = isPointer(id) ? 'latest'
      : (v.type === 'auto' || v.type === 'manual') ? v.type
      : 'manual';
    var rid = tree.rootId || v.runId || (isPointer(id) && id.length > 5 ? id.slice(5) : '') || '';
    var size = 0;
    try { size = JSON.stringify(v).length; } catch (e) {}
    return {
      id: id,
      at: v.at || 0,
      type: type,
      imported: !!v.imported || /\(导入\d+\)$/.test(id),
      name: v.name || (!isPointer(id) && !isNode(id) ? id : ''),
      title: v.title || '',
      turns: (v.history || []).length,          // 老字段：消息条数，周目列表还在用
      round: v.round != null ? v.round : roundsOf(v.history),
      lines: (v.log || []).length,
      opening: v.opening || '',
      runId: v.runId || rid,
      auto: isPointer(id),                      // 老字段：是不是「最新进度」指针
      rootId: rid || ('solo:' + id),
      nodeId: tree.nodeId || (isPointer(id) ? (v.node || '') : ''),
      parentNodeId: tree.parentNodeId || '',
      summary: v.summary || summaryOf(v),
      kb: Math.round(size / 1024)
    };
  }

  /**
   * 把摘要列表整理成一棵棵树。
   * @returns [{ rootId, title, nodes:[{ s, depth, children, isLatest }], nodeCount, branchCount,
   *             latest, kb, pointer }]   —— 按最近活动排序
   */
  function buildTrees(list) {
    var byRoot = {};
    (list || []).forEach(function (s) {
      (byRoot[s.rootId] = byRoot[s.rootId] || []).push(s);
    });
    var out = Object.keys(byRoot).map(function (rid) {
      var all = byRoot[rid];
      var pointer = all.filter(function (s) { return s.type === 'latest'; })
                       .sort(function (a, b) { return b.at - a.at; })[0] || null;
      var items = all.filter(function (s) { return s.type !== 'latest'; });
      /* 树里一个节点都没有（老版本只有 auto 指针）时，指针本身当唯一的节点 */
      if (!items.length && pointer) items = [pointer];

      /* 节点按 nodeId 连；nodeId 撞了（重复导入）就按槽位 id 区分 */
      var key = {}, nodes = {};
      items.forEach(function (s) {
        var k = s.nodeId && !key[s.nodeId] ? s.nodeId : 'slot:' + s.id;
        key[k] = s.id;
        nodes[s.id] = { s: s, key: k, children: [], depth: 0 };
      });
      var roots = [];
      items.forEach(function (s) {
        var n = nodes[s.id];
        var pid = s.parentNodeId && key[s.parentNodeId];
        if (pid && pid !== s.id) nodes[pid].children.push(n);
        else roots.push(n);
      });
      var order = [];
      function byTime(a, b) { return a.s.at - b.s.at; }
      function visit(n, d) {
        n.depth = d;
        order.push(n);
        n.children.sort(byTime).forEach(function (c) { visit(c, d + 1); });
      }
      roots.sort(byTime).forEach(function (r) { visit(r, 0); });

      var latest = items.slice().sort(function (a, b) { return b.at - a.at; })[0];
      order.forEach(function (n) { n.isLatest = n.s === latest; });
      var forks = order.filter(function (n) { return n.children.length > 1; }).length;
      var kb = items.reduce(function (t, s) { return t + (s.kb || 0); }, 0);
      var named = items.filter(function (s) { return s.opening; })[0];
      return {
        rootId: rid,
        title: (named && named.opening) || (latest && (latest.name || latest.title)) || '未命名开局',
        nodes: order,
        nodeCount: items.length,
        branchCount: Math.max(0, roots.length - 1) + forks,
        latest: latest,
        pointer: pointer,
        kb: kb,
        at: Math.max(latest ? latest.at : 0, pointer ? pointer.at : 0)
      };
    });
    return out.sort(function (a, b) { return b.at - a.at; });
  }

  /**
   * 自动节点超过上限时删哪些。手动节点、正在用的节点、以及它的祖先链不删。
   * 被删节点的子节点改挂到最近的、没被删的祖先上，树不会断。
   * @returns { del:[槽位id], reparent:[{ id: 槽位id, parentNodeId }] }
   */
  function planPrune(list, rootId, activeNode, keep) {
    keep = keep == null ? AUTO_KEEP : keep;
    var mine = (list || []).filter(function (s) { return s.rootId === rootId && s.type !== 'latest'; });
    var byNode = {};
    mine.forEach(function (s) { if (s.nodeId) byNode[s.nodeId] = s; });
    /* 正在用的节点和它往上的整条链都得留着 —— 那是玩家当前所在的剧情线 */
    var protect = {};
    var cur = activeNode, guard = 0;
    while (cur && byNode[cur] && guard++ < 10000) { protect[cur] = 1; cur = byNode[cur].parentNodeId; }

    var autos = mine.filter(function (s) { return s.type === 'auto' && !s.imported; })
                    .sort(function (a, b) { return b.at - a.at; });
    var gone = {};
    var del = [];
    autos.slice(keep).forEach(function (s) {
      if (protect[s.nodeId]) return;
      gone[s.nodeId] = 1; del.push(s.id);
    });
    /* 链上保护的节点太多时（一条很长的线），上面这步删不够，那就从链的最老处开始删，
       但当前节点本身和它的父节点始终保留 */
    var left = autos.filter(function (s) { return !gone[s.nodeId]; });
    if (left.length > keep) {
      var chainOld = left.filter(function (s) { return protect[s.nodeId]; })
                         .sort(function (a, b) { return a.at - b.at; });
      var cutN = left.length - keep;
      var parentOfActive = byNode[activeNode] && byNode[activeNode].parentNodeId;
      chainOld.forEach(function (s) {
        if (cutN <= 0 || s.nodeId === activeNode || s.nodeId === parentOfActive) return;
        gone[s.nodeId] = 1; del.push(s.id); cutN--;
      });
    }
    var reparent = [];
    mine.forEach(function (s) {
      if (gone[s.nodeId] || !s.parentNodeId || !gone[s.parentNodeId]) return;
      var p = s.parentNodeId, g = 0;
      while (p && gone[p] && g++ < 10000) p = byNode[p] ? byNode[p].parentNodeId : '';
      reparent.push({ id: s.id, parentNodeId: p || '' });
    });
    return { del: del, reparent: reparent };
  }

  /** 所有属于这棵树的槽位（删整树 / 导出整树用），含最新进度指针 */
  function slotsOfTree(list, rootId) {
    return (list || []).filter(function (s) { return s.rootId === rootId; }).map(function (s) { return s.id; });
  }

  global.SaveTree = {
    AUTO_KEEP: AUTO_KEEP, newId: newId, isPointer: isPointer, isNode: isNode,
    summarize: summarize, summaryOf: summaryOf, roundsOf: roundsOf,
    buildTrees: buildTrees, planPrune: planPrune, slotsOfTree: slotsOfTree
  };
})(typeof window !== 'undefined' ? window : globalThis);
