const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const NARROW = process.env.NARROW === '1';

// 把本地脚本内联进来，避免依赖 jsdom 的资源加载（jsdom 30 已移除 ResourceLoader）
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
  .replace('<script src="corpus.js"></script>',
           '<script>' + fs.readFileSync(path.join(__dirname, 'corpus.js'), 'utf8') + '</script>')
  .replace('<script src="engine.js"></script>',
           '<script>' + fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8') + '</script>');
const errors = [];

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/',
  beforeParse(win) {
    win.matchMedia = q => ({
      matches: NARROW ? /max-width:\s*(1199|900|640)px/.test(q) : false,
      media: q, onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; }
    });
    win.Element.prototype.scrollIntoView = function () {};
    win.Element.prototype.scrollTo = function () {};
  },
  virtualConsole: new (require('jsdom').VirtualConsole)()
    .on('jsdomError', e => errors.push('jsdomError: ' + e.message))
    .on('error', (...a) => errors.push('console.error: ' + a.join(' ')))
});

const { window } = dom;
const { document } = window;
const wait = ms => new Promise(r => setTimeout(r, ms));
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const check = (n, c, x) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (x ? '  → ' + x : '')); if (!c) errors.push('assert: ' + n); };

(async () => {
  await wait(300);          // 等 corpus.js / engine.js 加载并建索引

  console.log('--- 语料与索引 ---');
  check('corpus.js 已加载', !!window.CORPUS, window.CORPUS && window.CORPUS.items.length + ' 题');
  check('engine.js 已加载', !!window.MLEngine);
  check('题库 175 题', window.CORPUS.items.length === 175, String(window.CORPUS.items.length));
  check('检索块 193 条', window.CORPUS.chunks.length === 193, String(window.CORPUS.chunks.length));
  check('语料来源标注正确', window.CORPUS.source === 'github.com/whyza/itcast_interview', window.CORPUS.source);

  console.log('--- 初始化界面 ---');
  const ACTIVE = window.CORPUS.chapters.filter(c => c.count > 0);
  check('顶栏微条数 = 有题篇章数', $$('#boardStrip .mod').length === ACTIVE.length, $$('#boardStrip .mod').length + ' / ' + ACTIVE.length);
  check('抽题范围列表同步', $$('#chapList .chap').length === ACTIVE.length);
  check('篇章默认全选', $$('#chapList .chap[aria-pressed="true"]').length === ACTIVE.length);
  check('知识库卡显示真实来源', $('#libSrc').textContent.includes('itcast_interview'), $('#libSrc').textContent);
  click($('#libBtn'));
  check('知识库展开含真实文件名', $$('#libBody .lib__row').length >= ACTIVE.length, $$('#libBody .lib__row').length + ' 行');
  check('已答数为 0', $('#ansCount').textContent === '0');
  check('总掌握度未开始时显示「—」', $('#masteryVal').textContent === '—', $('#masteryVal').textContent);
  check('待复习徽标初始隐藏', $('#dueBadge').hidden === true);
  if (NARROW) check('点评面板关闭按钮初始不可见', $('#panelClose').hidden === true);

  console.log('--- 抽到真实题目 ---');
  const ml = window.__ml;
  check('暴露调试句柄', !!ml);
  const item = ml.ITEMS.find(x => x.q.includes('索引的底层数据结构'));
  check('能定位到真实题目', !!item, item && item.q);
  ml.drawQuestion(item.id);
  await wait(30);
  check('题面渲染为真实题干', $('#qText').textContent.includes('索引的底层数据结构'), $('#qText').textContent);
  check('篇章标签正确', $('#qTag').textContent.includes('数据库'), $('#qTag').textContent.trim());
  check('章节标签非空', $('#qSec').textContent.length > 0, $('#qSec').textContent);
  check('参考字数已显示', /\d+ 字参考/.test($('#qStat').textContent), $('#qStat').textContent);

  console.log('--- 空输入拦截 ---');
  click($('#submitBtn'));
  await wait(20);
  check('空输入不提交', $('#submitBtn').disabled === false && $('#analyzing').hidden === true);
  check('占位文案已提示', $('#composerInput').placeholder.includes('先写几句'), $('#composerInput').placeholder);

  console.log('--- 提交半答 → 要点比对 ---');
  $('#composerInput').value = 'B+ 树相比 B 树，非叶子节点不存数据只存索引，所以一个节点能放更多 key，树高会更低。另外叶子节点之间有双向链表，做范围查询很快。';
  click($('#submitBtn'));
  check('按钮进入比对中', $('#submitBtn').disabled === true);
  check('骨架屏出现', $('#analyzing').hidden === false);
  check('作答已落对话流', !!$('#answerZone .mine'));
  await wait(1200);

  check('骨架屏收起', $('#analyzing').hidden === true);
  check('点评内容展示', $('#pContent').hidden === false);
  const pts = $$('#points .point');
  check('要点数在 3~6 之间', pts.length >= 3 && pts.length <= 6, pts.length + ' 条');
  check('要点状态合法', pts.every(p => ['hit','partial','miss'].includes(p.dataset.state)), pts.map(p=>p.dataset.state).join(','));
  check('覆盖度徽标已显示', $('#pointCount').hidden === false, $('#pointCount').textContent);
  check('覆盖度分母与要点数一致', $('#covDen').textContent.trim() === `/ ${pts.length} 要点`, $('#covDen').textContent.trim());
  check('有命中术语 chips', $$('#points .chip--on').length > 0, $$('#points .chip--on').length + ' 个');
  check('没答到的地方被划红波浪线', $$('#points .hl-miss').length > 0, $$('#points .hl-miss').length + ' 处');
  check('用时已记录', /^\d+:\d{2}$/.test($('#statTime').textContent), $('#statTime').textContent);
  check('遇见次数已记录', $('#statSeen').textContent === '第 1 次', $('#statSeen').textContent);
  check('一句话总评非空', $('#covNote').textContent.length > 10, $('#covNote').textContent.slice(0,40));

  console.log('--- RAG 溯源 ---');
  const srcs = $$('#srcList .srcitem');
  check('溯源命中 4 段', srcs.length === 4, srcs.length + ' 段');
  check('溯源显示文件路径与章节', $('#srcList .srcitem__file').textContent.includes('/'), $('#srcList .srcitem__file').textContent);
  check('相关度条已渲染', $$('#srcList .rel__bar i').length === 4);
  check('相关度最高为 1.00', $$('#srcList .rel__v')[0].textContent === '1.00', $$('#srcList .rel__v')[0].textContent);
  check('首选命中即本题', $('#srcList .srcitem__bd').textContent.includes('本题的讲义片段'));
  check('原文出处徽标已显示', $('#srcCount').hidden === false, $('#srcCount').textContent);
  check('每条要点都有出处脚注', $$('#points .point__ft .src').length === pts.length);

  console.log('--- 追问链（真实真题序列）---');
  const chain = $$('#reviewZone .nq');
  check('中栏出现「面试官接着会问」3 条', chain.length === 3, chain.length + ' 条');
  check('追问链标注来源理由', chain[0].querySelector('.nq__why').textContent.includes('下一问'), chain[0].querySelector('.nq__why').textContent);
  check('AI 追问 tab 同步追问链', $$('#askChain .nq').length === 3);

  console.log('--- 检索式追问 ---');
  ml.switchPane('ask');
  $('#askInput').value = '叶子节点为什么用双向链表？';
  click($('#askSend'));
  await wait(700);
  check('我的提问入列', $$('#chatLog .bub--me').length === 1);
  check('引擎给出引用式回答', $$('#chatLog .bub--ai').length === 1, $('#chatLog .bub--ai').textContent.slice(0, 30));
  check('回答带讲义出处', $$('#chatLog .cite').length >= 1, $$('#chatLog .cite').length + ' 条引用');
  check('引用注明文件与相关度', $('#chatLog .cite__t').textContent.includes('相关度'), $('#chatLog .cite__t').textContent.slice(0, 42));
  check('追问计数徽标更新', $('#askCount').textContent === '1' && $('#askCount').hidden === false);
  check('追问已持久化', (ml.state.chat[item.id] || []).length === 2);

  console.log('--- 掌握度 / 待复习 ---');
  check('总掌握度已计算', /^\d+%$/.test($('#masteryVal').textContent), $('#masteryVal').textContent);
  check('对应篇章掌握度已更新', $('#chapList .chap[data-chap="db"] .chap__pct').textContent !== '—', $('#chapList .chap[data-chap="db"] .chap__pct').textContent);
  check('已答计数 +1', $('#ansCount').textContent === '1', $('#ansCount').textContent);

  console.log('--- 加入待复习 ---');
  const dueBtn = $('#points .point:not([data-state="hit"]) [data-due]');
  if (dueBtn) { click(dueBtn); check('加入待复习按钮变为已加入', dueBtn.textContent === '已加入', dueBtn.textContent); }
  else check('存在可加入的要点按钮', false, '无漏答/半答要点');

  console.log('--- 下一题 / 状态复位 ---');
  click($('#submitBtn'));
  await wait(40);
  check('按钮复位为提交', $('#submitBtn').dataset.mode === 'submit');
  check('右栏回到空状态', $('#pEmpty').hidden === false && $('#pContent').hidden === true);
  check('作答区已清空', $('#composerInput').value === '');
  check('计时已重置', $('#timerVal').textContent === '00:00');
  check('题面已换', $('#qText').textContent.length > 4, $('#qText').textContent.slice(0, 24));

  console.log('--- 浮层 ---');
  click($('#masteryBtn'));
  check('掌握度浮层打开', $('#boardPop').dataset.open === '1');
  check('浮层列出全部有题篇章', $$('#boardGrid .bp').length === ACTIVE.length);
  click($('#engineBtn'));
  check('引擎浮层打开', $('#engPop').dataset.open === '1');
  check('引擎浮层两行', $$('#engList .engrow').length === 2);
  check('本地引擎标记运行中', $$('#engList .engrow')[0].dataset.on === '1' && $$('#engList .engrow')[0].textContent.includes('运行中'));
  check('云端引擎标记未启用', $$('#engList .engrow')[1].textContent.includes('未启用'));
  click($('#setBtn'));
  check('设置浮层打开', $('#setPop').dataset.open === '1');
  click($('#themeSwitch'));
  check('夜读配色可切换', document.documentElement.dataset.theme === 'night');
  click($('#themeSwitch'));
  check('切回日间配色', document.documentElement.dataset.theme === 'day');

  console.log('--- 抽题范围 ---');
  click($$('#chapList .chap')[0]);
  check('单项可取消', $$('#chapList .chap[aria-pressed="true"]').length === ACTIVE.length - 1);
  click($('#scopeToggle'));
  check('非全选态点击 → 全选', $$('#chapList .chap[aria-pressed="true"]').length === ACTIVE.length && $('#scopeToggle').textContent === '全不选');
  click($('#scopeToggle'));
  check('全选态点击 → 全不选', $$('#chapList .chap[aria-pressed="true"]').length === 0);
  click($('#scopeToggle'));

  console.log('--- 待复习抽屉 ---');
  click($('#dueBtn'));
  check('抽屉打开', $('#dueDrawer').dataset.open === '1' && $('#scrim').dataset.open === '1');
  click($('#drawerClose'));
  check('抽屉关闭', $('#dueDrawer').dataset.open === '0' && $('#scrim').dataset.open === '0');

  console.log('--- 本地引擎算法（分离验证）---');
  const E = window.MLEngine, IDX = ml.INDEX, ITEMS = ml.ITEMS;
  const it = ITEMS.find(x => x.q.includes('索引的底层数据结构'));
  const partial = E.evaluate(IDX, ITEMS, it, '非叶子节点不存数据只存索引，树高更低。');
  const full = E.evaluate(IDX, ITEMS, it, 'InnoDB 的索引用的是 B+ 树。第一，B+ 树的非叶子节点只存索引键和指针不存数据，所以一个 16KB 的页能放下几百个键，出度大、阶数多，树就只有三四层，磁盘 IO 次数少。第二，叶子节点用双向链表连起来，范围查询顺着链表扫就行，不用回溯。第三，所有数据都在叶子节点，查询路径长度一致，性能稳定。第四，和磁盘预读按页对齐，一次 IO 读一页。B 树就不一样，它的非叶子节点也存数据，范围查询要中序遍历。');
  const empty = E.evaluate(IDX, ITEMS, it, '');
  check('半答得分低于全答', partial.ratio < full.ratio, (partial.ratio*100).toFixed(0) + '% < ' + (full.ratio*100).toFixed(0) + '%');
  check('空答得分为 0', empty.ratio === 0);
  check('好答覆盖率 >= 90%', full.ratio >= 0.9, (full.ratio*100).toFixed(0) + '%');
  check('半答覆盖率 < 70%', partial.ratio < 0.7, (partial.ratio*100).toFixed(0) + '%');
  const off = E.evaluate(IDX, ITEMS, it, '线程池就是预先创建一些线程放在池子里复用，避免频繁创建销毁的开销。核心参数有核心线程数、最大线程数、阻塞队列、拒绝策略。');
  check('答成别的题触发答偏检测', !!off.offTopic, off.offTopic ? '→ ' + off.offTopic.item.q.slice(0, 22) : '未触发');

  if (NARROW) {
    console.log('--- 窄屏 ---');
    check('出现左栏唤出按钮', $('#railToggle').style.display === 'inline-flex');
    click($('#railToggle'));
    check('左栏抽屉打开', $('#rail').dataset.open === '1' && $('#scrim').dataset.open === '1');
    $$('.mtab')[2].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    check('切到点评', $('#panel').dataset.open === '1' && $('#rail').dataset.open === '0' && $('#panelClose').hidden === false);
    $$('.mtab')[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    check('切回答题时抽屉全收', $('#panel').dataset.open === '0' && $('#rail').dataset.open === '0' && $('#scrim').dataset.open === '0');
  }

  console.log('\n================ 结果 ================');
  if (errors.length) { console.log('发现 ' + errors.length + ' 个问题：'); errors.forEach(e => console.log('  · ' + e)); }
  else console.log('全部断言通过，未捕获到运行时错误。');
  window.close();
  process.exit(errors.length ? 1 : 0);
})();
