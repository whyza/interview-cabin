const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const FILE = 'file:///' + path.join(__dirname, 'index.html').replace(/\\/g, '/');
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'desktop-1440', w: 1440, h: 900 },
  { name: 'laptop-1280',  w: 1280, h: 860 },
  { name: 'tablet-1024',  w: 1024, h: 820 },
  { name: 'mobile-390',   w: 390,  h: 844 }
];

const ANSWER = 'InnoDB 的索引用的是 B+ 树。第一，B+ 树的非叶子节点只存索引键和指针不存数据，所以一个 16KB 的页能放下几百个键，出度大、阶数多，树就只有三四层，磁盘 IO 次数少。第二，叶子节点用双向链表连起来，范围查询顺着链表扫就行，不用回溯。第三，所有数据都在叶子节点，查询路径长度一致，性能稳定。';

(async () => {
  const localChrome = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
  const launchOpts = fs.existsSync(localChrome) ? { executablePath: localChrome } : {};
  const browser = await chromium.launch(launchOpts);
  const problems = [];

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

    await page.goto(FILE, { waitUntil: 'load' });
    await page.waitForTimeout(1200);           // 等语料 + 建索引

    const layout = await page.evaluate(() => {
      const vis = sel => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
      const css = (sel, p) => { const el = document.querySelector(sel); return el ? getComputedStyle(el)[p] : null };
      const shown = sel => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 };
      return {
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        rail: vis('.rail'), stage: vis('.stage'), panel: vis('.panel'),
        mtabs: css('.mtabs', 'display'),
        colCount: ['.rail', '.stage', '.panel'].filter(s => {
          const el = document.querySelector(s); const r = el.getBoundingClientRect();
          return r.width > 0 && getComputedStyle(el).transform === 'none';
        }).length,
        qText: (document.querySelector('#qText') || {}).textContent || '',
        corpusItems: window.CORPUS ? window.CORPUS.items.length : 0,
        chunks: window.CORPUS ? window.CORPUS.chunks.length : 0,
        chapterCount: document.querySelectorAll('#chapList .chap').length,
        analyzingShown: shown('#analyzing'),
        emptyShown: shown('#pEmpty'),
        contentShown: shown('#pContent'),
        pointBadge: shown('#pointCount'),
        srcBadge: shown('#srcCount')
      };
    });

    console.log(`\n── ${vp.name} (${vp.w}×${vp.h}) ──`);
    console.log(`   语料：${layout.corpusItems} 题 / ${layout.chunks} 检索块 / ${layout.chapterCount} 篇章`);
    console.log(`   常驻栏数: ${layout.colCount}  (rail ${layout.rail.w} / stage ${layout.stage.w} / panel ${layout.panel.w})`);
    console.log(`   横向溢出: ${layout.overflowX}px ${layout.overflowX <= 1 ? '✓' : '✗'}`);
    console.log(`   底部 Tab: ${layout.mtabs}  ${vp.w < 1200 ? (layout.mtabs === 'block' ? '✓' : '✗') : '（桌面不需要）'}`);
    console.log(`   初始右栏: 骨架屏 ${layout.analyzingShown ? '显示✗' : '隐藏✓'} / 空状态 ${layout.emptyShown ? '显示✓' : '隐藏✗'} / 内容 ${layout.contentShown ? '显示✗' : '隐藏✓'}`);
    console.log(`   抽到题目: ${layout.qText.slice(0, 34)}…`);

    if (layout.overflowX > 1) problems.push(vp.name + ' 横向溢出 ' + layout.overflowX + 'px');
    if (vp.w >= 1200 && layout.colCount !== 3) problems.push(vp.name + ' 桌面应为三栏，实际 ' + layout.colCount);
    if (vp.w < 1200 && layout.colCount !== 1) problems.push(vp.name + ' 窄屏应只有中栏常驻，实际 ' + layout.colCount);
    if (vp.w < 1200 && layout.mtabs !== 'block') problems.push(vp.name + ' 移动端底部导航未启用');
    if (!(layout.corpusItems >= 170)) problems.push(vp.name + ' 语料未正确加载: ' + layout.corpusItems);
    if (layout.analyzingShown || !layout.emptyShown || layout.contentShown) problems.push(vp.name + ' 初始右栏可见性错误');
    if (!layout.qText || layout.qText.length < 6) problems.push(vp.name + ' 未抽到题目');

    // 进度条尺寸护栏（含要点覆盖环）
    const bars = await page.evaluate(() => {
      const t = [['#boardStrip .mod__bar i', '篇章微条'], ['#boardGrid .bp__track i', '看板条'], ['#chapList .chap__prog i', '篇章进度']];
      const bad = [];
      for (const [sel, name] of t) document.querySelectorAll(sel).forEach((el, i) => {
        if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true })) return;
        // 掌握度为 0 时宽度本就该是 0%（还没答题），不算渲染缺陷
        if (/%$/.test(el.style.width) && parseFloat(el.style.width) === 0) return;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) bad.push(`${name}[${i}] ${Math.round(r.width)}×${Math.round(r.height)}`);
      });
      return bad;
    });
    if (bars.length) { console.log('   ✗ 零尺寸填充块:', bars.join(', ')); problems.push(vp.name + ' 进度条零尺寸'); }
    else console.log('   进度条/填充块: 正常 ✓');

    await page.screenshot({ path: path.join(OUT, vp.name + '.png') });

    if (vp.name === 'desktop-1440') {
      // 选一道确定的题，跑完整链路
      await page.evaluate(() => {
        const it = window.__ml.ITEMS.find(x => x.q.includes('索引的底层数据结构'));
        window.__ml.drawQuestion(it.id);
      });
      await page.fill('#composerInput', ANSWER);
      await page.click('#submitBtn');
      await page.waitForTimeout(1600);

      const post = await page.evaluate(() => {
        const shown = s => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 };
        const pts = [...document.querySelectorAll('#points .point')];
        return {
          points: pts.length,
          states: pts.map(p => p.dataset.state).join(','),
          covBadge: document.querySelector('#pointCount').textContent,
          srcCount: document.querySelectorAll('#srcList .srcitem').length,
          srcBadge: document.querySelector('#srcCount').textContent,
          followupChain: document.querySelectorAll('#reviewZone .nq').length,
          askChain: document.querySelectorAll('#askChain .nq').length,
          chips: document.querySelectorAll('#points .chip').length,
          hl: document.querySelectorAll('#points .hl-miss').length,
          mastery: document.querySelector('#masteryVal').textContent,
          ansCount: document.querySelector('#ansCount').textContent,
          reviewing: !!document.querySelector('#askChain .nq'),
          contentShown: shown('#pContent'), emptyShown: shown('#pEmpty'), analyzingShown: shown('#analyzing'),
          ptHeights: pts.map(p => Math.round(p.getBoundingClientRect().height))
        };
      });
      console.log('   提交后:', JSON.stringify(post));
      if (post.points < 3 || post.srcCount !== 4 || post.followupChain !== 3) problems.push('desktop-1440 点评面板渲染异常: ' + JSON.stringify(post));
      if (post.emptyShown || post.analyzingShown || !post.contentShown) problems.push('desktop-1440 提交后右栏可见性错误');
      // 设计主张：红笔只划「答了一半」的缺口。满分答案不该出现任何红线。
      if (post.chips < 1) problems.push('desktop-1440 术语 chips 未渲染');
      if (post.hl !== 0) problems.push('desktop-1440 满分答案不该出现红波浪线，实际 ' + post.hl);
      if (!/^\d+%$/.test(post.mastery)) problems.push('desktop-1440 掌握度未更新: ' + post.mastery);
      if (post.ptHeights.some(h => h < 60)) problems.push('desktop-1440 要点卡片高度异常');
      await page.screenshot({ path: path.join(OUT, 'desktop-1440-reviewed.png') });

      // 原文出处 tab
      await page.click('.ptab[data-pane="src"]');
      await page.waitForTimeout(250);
      const srcShown = await page.evaluate(() => {
        const p = document.querySelector('.panel__pane[data-pane="src"]');
        const r = p.getBoundingClientRect();
        return { active: p.dataset.active, h: Math.round(r.height), items: document.querySelectorAll('#srcList .srcitem').length };
      });
      console.log('   原文出处 tab:', JSON.stringify(srcShown));
      if (srcShown.active !== '1' || srcShown.items !== 4) problems.push('desktop-1440 原文出处 tab 异常');
      await page.screenshot({ path: path.join(OUT, 'desktop-1440-sources.png') });

      // AI 追问
      await page.click('.ptab[data-pane="ask"]');
      await page.fill('#askInput', '叶子节点为什么用双向链表？');
      await page.click('#askSend');
      await page.waitForTimeout(900);
      const askShown = await page.evaluate(() => ({
        me: document.querySelectorAll('#chatLog .bub--me').length,
        ai: document.querySelectorAll('#chatLog .bub--ai').length,
        cites: document.querySelectorAll('#chatLog .cite').length,
        badge: document.querySelector('#askCount').textContent
      }));
      console.log('   AI 追问:', JSON.stringify(askShown));
      if (askShown.me !== 1 || askShown.ai !== 1 || askShown.cites < 1) problems.push('desktop-1440 追问链路异常: ' + JSON.stringify(askShown));
      await page.screenshot({ path: path.join(OUT, 'desktop-1440-ask.png') });

      // 引擎浮层 / 深色 / 待复习抽屉
      await page.click('#engineBtn');
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(OUT, 'desktop-1440-engine.png') });
      await page.click('#setBtn');
      await page.waitForTimeout(300);
      await page.click('#themeSwitch');
      await page.waitForTimeout(450);
      await page.mouse.click(700, 780);
      await page.waitForTimeout(250);
      console.log('   深色主题 body:', await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
      await page.screenshot({ path: path.join(OUT, 'desktop-1440-night.png') });
      await page.click('#themeSwitch').catch(() => {});
      await page.click('#dueBtn');
      await page.waitForTimeout(650);
      await page.screenshot({ path: path.join(OUT, 'desktop-1440-due.png') });
      await page.keyboard.press('Escape');

      // 反向：半答必须出现红波浪线，且缺口 chips 存在
      await page.evaluate(() => { document.documentElement.dataset.theme = 'day'; });
      await page.evaluate(() => {
        const it = window.__ml.ITEMS.find(x => x.q.includes('索引的底层数据结构'));
        window.__ml.drawQuestion(it.id);
      });
      await page.fill('#composerInput', 'B+ 树相比 B 树，非叶子节点不存数据只存索引，所以一个节点能放更多 key，树高会更低。另外叶子节点之间有双向链表，做范围查询很快。');
      await page.click('#submitBtn');
      await page.waitForTimeout(1600);
      const half = await page.evaluate(() => ({
        hl: document.querySelectorAll('#points .hl-miss').length,
        missChips: document.querySelectorAll('#points .chip--off').length,
        states: [...document.querySelectorAll('#points .point')].map(p => p.dataset.state).join(','),
        cells: [...document.querySelectorAll('#covCells .cell')].map(c => c.dataset.s).join(',')
      }));
      console.log('   半答批改:', JSON.stringify(half));
      if (half.hl < 1) problems.push('desktop-1440 半答应出现红波浪线，实际 0');
      if (half.missChips < 1) problems.push('desktop-1440 半答应有「没答到」chips');
      await page.screenshot({ path: path.join(OUT, 'desktop-1440-partial.png') });
    }

    if (vp.name === 'mobile-390') {
      await page.evaluate(() => {
        const it = window.__ml.ITEMS.find(x => x.q.includes('索引的底层数据结构'));
        window.__ml.drawQuestion(it.id);
      });
      await page.fill('#composerInput', ANSWER);
      await page.click('#submitBtn');
      await page.waitForTimeout(1600);
      await page.screenshot({ path: path.join(OUT, 'mobile-390-panel.png') });
      await page.click('.mtab[data-view="rail"]');
      await page.waitForTimeout(650);
      await page.screenshot({ path: path.join(OUT, 'mobile-390-rail.png') });
    }

    if (errs.length) { console.log('   ✗ 运行时错误:', errs.join(' | ')); problems.push(vp.name + ': ' + errs.join(' | ')); }
    else console.log('   运行时错误: 无 ✓');
    await ctx.close();
  }

  await browser.close();
  console.log('\n================ 结果 ================');
  console.log(problems.length ? '问题：\n  · ' + problems.join('\n  · ') : '多视口渲染全部通过：无运行时错误、无横向溢出，真实语料与 AI 链路正常。');
  console.log('截图:', OUT);
  process.exit(problems.length ? 1 : 0);
})();
