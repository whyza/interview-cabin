/* ============================================================
   面试舱 · 本地 AI 引擎（engine.js）
   ------------------------------------------------------------
   不依赖任何后端，在浏览器里真实完成四件事：
     1. RAG 检索    —— CJK n-gram 倒排索引 + BM25，从讲义语料召回相关片段
     2. 要点拆解    —— 把候选人参考答案切成 3~6 个可逐条核对的要点
     3. 覆盖度评分  —— 以要点的高 IDF 术语为标尺，测算作答覆盖到哪几条
     4. 追问链      —— 从语料取真实后续真题（讲义本身就是面试官追问序列）
   外加「答偏检测」：若作答实际命中另一道题，直接点出来，而不是给个低分。
   设计原则：能算的就算，算不出的不装；所有结果带置信提示。
   ============================================================ */
(function (global) {
  'use strict';

  const CJK = /[\u4e00-\u9fff]/;
  const CJK_RUN = /[\u4e00-\u9fff]+/g;
  const TOKEN_RE = /[A-Za-z][A-Za-z0-9_+#.\-]{1,}|[\u4e00-\u9fff]+|\d+/g;
  // 混合术语：B+树、16KB页、newCachedThreadPool池 —— 字母/数字打头，可带 + - # .，后接 1 个汉字
  const MIXED_RE = /[A-Za-z0-9][A-Za-z0-9+#.\-]*[\u4e00-\u9fff]/g;
  const TRAIL_FUNC = /[的了是在和与或也都就很会能要有不这那我你们个来去把被为以及等之其而但则若如让使对从到于将并]+$/;

  /** 抽取「字母+符号+汉字」的混合术语，并修掉尾巴上的功能字 */
  function mixedTokens(text, minLen) {
    minLen = minLen || 3;
    const out = [];
    let m;
    MIXED_RE.lastIndex = 0;
    const s = String(text || '');
    while ((m = MIXED_RE.exec(s))) {
      const t = m[0].replace(TRAIL_FUNC, '');
      if (t.length >= minLen) out.push(t.toLowerCase());
    }
    return out;
  }

  /** 抽取检索单元：ASCII 词 + 混合术语 + CJK bigram（中文免分词的成熟做法） */
  function tokenize(text) {
    const out = [];
    let m;
    TOKEN_RE.lastIndex = 0;
    const s = String(text || '');
    for (const t of mixedTokens(s)) out.push(t);
    while ((m = TOKEN_RE.exec(s))) {
      const t = m[0];
      if (CJK.test(t[0])) {
        if (t.length === 1) { out.push(t); continue; }
        for (let i = 0; i < t.length - 1; i++) {
          const bg = t.slice(i, i + 2);
          if (!NOISE.has(bg)) out.push(bg);
        }
      } else out.push(t.toLowerCase());
    }
    return out;
  }

  /* 高频功能词成的 bigram，无区分度，检索时剔除 */
  const NOISE = new Set(['什么', '怎么', '如何', '我们', '这个', '那个', '可以', '就是', '因为', '所以',
    '如果', '然后', '的话', '一个', '进行', '使用', '通过', '主要', '一般', '其实', '那么', '这样',
    '时候', '现在', '比较', '还是', '以及', '或者', '并且', '而且', '但是', '不过', '这些', '那些',
    '问题', '情况', '方面', '东西', '一种', '一下', '一些', '很多', '非常', '特别', '直接', '最终']);

  /** CJK n-gram（2~5 字）—— 用于抽「术语标尺」，比 bigram 更接近真实词汇 */
  function grams(text, minL, maxL) {
    minL = minL || 2; maxL = maxL || 5;
    const out = [];
    const runs = String(text || '').match(CJK_RUN) || [];
    for (const run of runs) {
      if (run.length < minL) continue;
      for (let L = minL; L <= Math.min(maxL, run.length); L++) {
        for (let i = 0; i + L <= run.length; i++) out.push(run.slice(i, i + L));
      }
    }
    return out;
  }

  /* ---------- BM25 + n-gram 术语统计 ---------- */
  function buildIndex(chunks) {
    const df = new Map();       // bigram / ASCII 的文档频率（供 BM25）
    const gdf = new Map();      // 3~5 字 n-gram 的文档频率（供术语标尺）
    const docs = chunks.map(c => {
      const toks = tokenize(c.text);
      const tf = new Map();
      for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
      for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
      // 同一文档内的 n-gram 去重后再计频，得到的才是真正的 DF
      const gs = new Set(grams(c.text, 3, 5));
      for (const g of gs) gdf.set(g, (gdf.get(g) || 0) + 1);
      return { id: c.id, len: toks.length, tf };
    });
    const N = docs.length;
    const avgdl = docs.reduce((a, d) => a + d.len, 0) / Math.max(N, 1);
    const mk = m => { const o = new Map(); for (const [t, n] of m) o.set(t, Math.log(1 + (N - n + 0.5) / (n + 0.5))); return o; };
    return { docs, df, gdf, idf: mk(df), gidf: mk(gdf), N, avgdl, chunks };
  }

  const K1 = 1.4, B = 0.72;

  function retrieve(index, query, opt) {
    opt = opt || {};
    const k = opt.k || 4;
    const qset = [...new Set(tokenize(query))];
    if (!qset.length) return [];
    const scored = [];
    for (let i = 0; i < index.docs.length; i++) {
      const d = index.docs[i], chunk = index.chunks[i];
      if (opt.chapter && chunk.ch !== opt.chapter) continue;
      if (opt.exclude && opt.exclude.indexOf(chunk.id) >= 0) continue;
      let s = 0;
      for (const t of qset) {
        const f = d.tf.get(t);
        if (!f) continue;
        s += (index.idf.get(t) || 0) * (f * (K1 + 1)) / (f + K1 * (1 - B + B * d.len / index.avgdl));
      }
      if (s > 0) scored.push({ i, score: s });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, k);
    const max = top.length ? top[0].score : 1;
    return top.map(x => ({ ...index.chunks[x.i], score: x.score, rel: x.score / max }));
  }

/* ---------- 要点拆解 ---------- */
// 结构标记：「第一/第二个/第三是」、1./2.)、①、换行、句末标点，任一都是天然切点。
// 排除「第一次/第三天」这类非列举用法。
const MARK = /(?:第[一二三四五六七八九十]{1,2}(?![次天周月年批期])|[（(]?\d{1,2}[）).、．]\s|[①②③④⑤⑥⑦⑧⑨⑩])/g;

function atoms(text) {
  let s = String(text || '').replace(/\s*\n\s*/g, ' § ').trim();
  s = s.replace(MARK, m => ' § ' + m);          // 在结构标记前断开
  return s.split(/§|(?<=[。；;!?！？])/)
    .map(x => x.replace(/\s+/g, ' ').trim())
    .filter(x => x.length > 3);
}

/** 在最近的逗号处切分过长单元，保证要点数不至于过少 */
function splitLong(unit, maxLen) {
  if (unit.length <= maxLen) return null;
  const mid = Math.floor(unit.length / 2);
  let cut = -1;
  for (let d = 0; d < unit.length; d++) {
    for (const i of [mid - d, mid + d]) {
      if (i > 8 && i < unit.length - 8 && '，,、：:'.includes(unit[i])) { cut = i + 1; break; }
    }
    if (cut > 0) break;
  }
  if (cut < 0) return null;
  return [unit.slice(0, cut).trim(), unit.slice(cut).trim()];
}

/** 把参考答案切成 3~6 个长度均衡的要点 */
function splitPoints(answer, index, question) {
  const text = String(answer || '').trim();
  if (!text) return [];
  let units = atoms(text);
  if (!units.length) units = [text];

  // 1) 把过短的碎片并入相邻单元（避免「这种情况大概率是遭到了攻击。」独占一条）
  for (let guard = 0; guard < 40 && units.length > 1; guard++) {
    const mi = units.findIndex(u => u.length < 18);
    if (mi < 0) break;
    const j = mi === 0 ? 1 : mi - 1;
    const merged = mi < j ? units[mi] + units[j] : units[j] + units[mi];
    units.splice(Math.max(mi, j), 1);
    units.splice(Math.min(mi, j), 1, merged);
  }

  // 2) 要点太少时，按逗号把最长的拆开，保证至少 3 条
  for (let guard = 0; guard < 30 && units.length < 3; guard++) {
    let mi = 0;
    for (let i = 1; i < units.length; i++) if (units[i].length > units[mi].length) mi = i;
    const parts = splitLong(units[mi], 90);
    if (!parts) break;
    units.splice(mi, 1, parts[0], parts[1]);
  }

  // 3) 太碎时合并到 3~6 条
  const total = units.reduce((a, u) => a + u.length, 0);
  const target = Math.max(3, Math.min(6, Math.round(total / 120)));
  while (units.length > target) {
    let mi = 0;
    for (let i = 1; i < units.length; i++) if (units[i].length < units[mi].length) mi = i;
    const j = mi === units.length - 1 ? mi - 1 : mi + 1;
    const merged = mi < j ? units[mi] + units[j] : units[j] + units[mi];
    units.splice(Math.max(mi, j), 1);
    units.splice(Math.min(mi, j), 1, merged);
  }
  return units.map((u, i) => ({ idx: i + 1, text: u, terms: keyTerms(u, index, 6, question) }));
}

  /* ---------- 术语标尺 ---------- */
  const DF_MIN = 2;                               // 至少出现在 2 个检索块里，滤掉一次性噪音串
  // 坏边界字符：以这些字打头/收尾的多半是跨词边界的窗口串（「一个双向链」「子节点是一」）。
  // 「点」不能入表 —— 节点 / 重点 / 优点 都是正常词尾。
  const EDGE_BAD = /^[的了是在和与或也都就很会能要有不这那我你们个来去把被为以及等之其而但则若如让使对从到于将并增减多少种些条一]|[的了是在和与或也都就很会能要有不这那我你们个来去把被为以及等之其而但则若如让使对从到于将并增减多少种些条]$/;

  /** 两串是否共享一段 >=n 的连续子串（用于剔除跨词边界的错位窗口） */
  function shareRun(a, b, n) {
    n = Math.min(n, a.length, b.length);
    if (n < 2) return false;
    for (let i = 0; i + n <= a.length; i++) if (b.indexOf(a.slice(i, i + n)) >= 0) return true;
    return false;
  }

  function keyTerms(text, index, limit, excludeText) {
    limit = limit || 6;
    const s = String(text || '');
    // 题干里已经给出的词（如题目就问「索引的数据结构」）不该记为作答命中，
    // 否则照着题目复述就能拿分。这里做一次词面剔除。
    const EX = excludeText ? String(excludeText) : '';
    const isGiven = t => EX && EX.indexOf(t.toUpperCase()) >= 0 || (EX && EX.toLowerCase().indexOf(t) >= 0);
    const cand = new Map();

    // 0) 混合术语（B+树 / 16KB页 / MySQL索引）—— 中文技术问答里最关键的一类词，
    //    纯 ASCII 或纯 CJK 的正则都抓不到，必须单独一遍。
    for (const mx of mixedTokens(s)) { if (!isGiven(mx)) cand.set(mx, 16 + mx.length * 1.5) }

    // 1) ASCII 术语（HashMap / corePoolSize / RDB / MVCC）—— 最强信号，恒定高权重
    for (const a of (s.match(/[A-Za-z][A-Za-z0-9_+#.\-]{1,}/g) || [])) {
      if (a.length < 3) continue;
      const t = a.toLowerCase();
      if (isGiven(t)) continue;
      const df = index ? (index.df.get(t) || 2) : 2;
      cand.set(t, Math.pow(df, 0.5) * Math.pow(t.length, 1.5) * 2.2);
    }

    // 2) CJK n-gram —— IDF 加权（术语要有区分度），同时：
    //    · 用 df 做地板，剔除只出现一次的窗口错位串
    //    · 用 df 天花板，剔除「数据/节点」这类全库通用词
    const UBQ = index ? index.N * 0.26 : 50;
    const counts = new Map();
    for (const g of grams(s, 2, 5)) counts.set(g, (counts.get(g) || 0) + 1);
    for (const [g, f] of counts) {
      const long = g.length >= 3;
      const df = index ? (long ? (index.gdf.get(g) || 0) : (index.df.get(g) || 0)) : 2;
      // 越长的 n-gram 越需要复现证据，否则 5 字窗口串会靠「字多」挤掉真术语
      const need = g.length >= 5 ? 3 : (g.length === 4 ? 2 : 3);
      if (df < need || df > UBQ) continue;
      if (EDGE_BAD.test(g)) continue;
      if (isGiven(g)) continue;
      const idf = index ? (long ? (index.gidf.get(g) || 4) : (index.idf.get(g) || 4)) : 4;
      // 可复现性加成：跨文档复现越多越像术语（窗口错位串恰好不复发）
      cand.set(g, idf * Math.pow(g.length, 1.75) * Math.log(1 + df) * Math.log(1 + f) * 0.06);
    }

    const arr = [...cand.entries()].sort((a, b) => b[1] - a[1]);
    const picked = [];
    for (const [t] of arr) {
      if (picked.length >= limit) break;
      // 互相包含、或共享 3 字以上连续片段 → 判为同一个词的不同窗口
      if (picked.some(p => p.includes(t) || t.includes(p) || shareRun(p, t, 3))) continue;
      picked.push(t);
    }
    return picked;
  }

  /* ---------- 覆盖度评分 ---------- */
  const HIT = 0.50, PART = 0.25;

  const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();

  function grade(answerText, points, index) {
    const mine = norm(answerText);
    const out = points.map(p => {
      const terms = p.terms;
      if (!terms.length) return { idx: p.idx, state: 'miss', cov: 0, matched: [], missing: [], text: p.text, terms };
      const matched = [], missing = [];
      let w = 0, tot = 0;
      for (const t of terms) {
        const idf = index ? (index.idf.get(t) || 4) : 4;
        const weight = idf * Math.pow(t.length, 0.35);   // 长术语更值钱
        tot += weight;
        if (mine.indexOf(t) >= 0) { w += weight; matched.push(t); } else missing.push(t);
      }
      const cov = tot ? w / tot : 0;
      return {
        idx: p.idx, text: p.text, terms, matched, missing, cov,
        state: cov >= HIT ? 'hit' : cov >= PART ? 'partial' : 'miss',
      };
    });
    const hitN = out.filter(x => x.state === 'hit').length;
    const partN = out.filter(x => x.state === 'partial').length;
    return {
      points: out, hitN, partN, missN: out.filter(x => x.state === 'miss').length,
      total: out.length, ratio: out.length ? (hitN + partN * 0.5) / out.length : 0,
    };
  }

  /* ---------- 答偏检测：作答其实命中了另一道题 ---------- */
  function detectOffTopic(index, items, item, answerText) {
    const mine = norm(answerText);
    if (mine.length < 24) return null;              // 太短不判
    const probe = retrieve(index, answerText, { k: 4 });
    if (!probe.length) return null;
    const top = probe[0];
    if (top.id === item.id) return null;
    const self = probe.find(x => x.id === item.id);
    const selfScore = self ? self.score : 0;
    if (top.score > selfScore * 1.35 && top.score > 2.4) {
      const it = items.find(x => x.id === top.id);
      return it ? { item: it, rel: top.rel, score: top.score } : null;
    }
    return null;
  }

  /* ---------- 追问链：语料里的真实后续真题 ---------- */
  function followups(index, items, item, opt) {
    opt = opt || {};
    const k = opt.k || 3, res = [], used = new Set([item.id]);
    const same = items.filter(x => x.ch === item.ch);
    const pos = same.findIndex(x => x.id === item.id);
    for (let i = pos + 1; i < same.length && res.length < 2; i++) {
      if (!used.has(same[i].id)) { res.push({ ...same[i], why: '同一篇章的下一问' }); used.add(same[i].id); }
    }
    for (const h of retrieve(index, item.q + ' ' + item.a.slice(0, 140), { k: k + 5 })) {
      if (res.length >= k) break;
      const it = items.find(x => x.id === h.id);
      if (!it || used.has(it.id)) continue;
      res.push({ ...it, why: it.ch === item.ch ? '同一篇章的相关题' : '其他篇章的关联题', rel: h.rel });
      used.add(it.id);
    }
    return res.slice(0, k);
  }

  /* ---------- 一次完整评估 ---------- */
  function evaluate(index, items, item, answerText) {
    const sources = retrieve(index, item.q + ' ' + answerText, { k: 4 });
    const self = sources.find(s => s.id === item.id);
    const refText = (item.a && item.a.length > 60) ? item.a
      : (self ? self.text : sources.map(s => s.text).join('\n'));
    const points = splitPoints(refText, index, item.q);
    const g = grade(answerText, points, index);
    const offTopic = detectOffTopic(index, items, item, answerText);
    return {
      engine: 'local', sources,
      points: g.points, hitN: g.hitN, partN: g.partN, missN: g.missN,
      total: g.total, ratio: g.ratio, offTopic,
      followups: followups(index, items, item, { k: 3 }),
      note: '本地引擎按术语覆盖度估算：表述与参考差异较大时可能低估，数字仅供自查参考。',
    };
  }

  global.MLEngine = { tokenize, grams, buildIndex, retrieve, splitPoints, keyTerms, grade, detectOffTopic, followups, evaluate };
})(typeof window !== 'undefined' ? window : globalThis);
