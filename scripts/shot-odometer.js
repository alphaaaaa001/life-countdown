/**
 * 滚轮读秒预览页的截图 + 端到端核对（预览用，未并入正式版）。
 *
 *   npm run shot-odometer          （或直接 electron scripts/shot-odometer.js）
 *
 * 与前一个截图脚本同样的两个坑：
 *  1. 环境若带 ELECTRON_RUN_AS_NODE=1，electron 会退化成纯 Node → 启动时 unset
 *  2. 窗口 show:false 时 CSS transition 冻结；这里正好要用它 ——
 *     冻住过渡后每根滚轮都停在「目标位」，截图可复现，而且能反推它到底停在第几格
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');

const FREEZE_CSS = `*, *::before, *::after {
  transition: none !important;
  animation: none !important;
}`;

// 逐根滚轮核对：从 transform 反推停在第几格 → 读出那一格的数字 → 跟真实读数比
const CHECK_REELS = `
  (() => {
    const p = readParts();
    const want = {
      hours:   odoDigitsOf(p.hours, 2),
      minutes: odoDigitsOf(p.minutes, 2),
      seconds: odoDigitsOf(p.seconds, 2)
    };
    const places = [
      ['hours', 1], ['hours', 0],
      ['minutes', 1], ['minutes', 0],
      ['seconds', 1], ['seconds', 0]
    ];
    const nodes = [...document.querySelectorAll('.reel')];
    const rows = [];
    nodes.forEach((reel, i) => {
      const [g, idx] = places[i];
      const track = reel.querySelector('.reel-track');
      const cellH = reel.getBoundingClientRect().height;
      const ty = new DOMMatrix(getComputedStyle(track).transform).m42;
      const offset = Math.round(-ty / cellH);
      const shown = track.children[offset] ? track.children[offset].textContent : '?';
      const expect = want[g][1 - idx];
      rows.push({
        place: g + (idx ? '.十' : '.个'),
        cycle: track.children.length / 2,
        offset, shown, expect,
        // 注意：textContent 是字符串，odoDigitsOf 给的是数字 —— 必须同型比
        ok: String(shown) === String(expect) && Math.abs(-ty / cellH - offset) < 0.02
      });
    });
    const group = document.querySelector('.odo-row');
    const probe = group.cloneNode(true);
    probe.style.cssText =
      'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;' +
      'display:inline-flex;width:auto;flex-wrap:nowrap;';
    document.body.appendChild(probe);
    const nowrapW = probe.getBoundingClientRect().width;
    probe.remove();
    return {
      rows,
      days: p.days,
      nowrapW: Math.round(nowrapW),
      availW: Math.round(group.getBoundingClientRect().width),
      rowH: Math.round(group.getBoundingClientRect().height),
      digitPx: getComputedStyle(nodes[0]).fontSize
    };
  })()
`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280, height: 900, show: false,
    webPreferences: { backgroundThrottling: false, nodeIntegration: false, contextIsolation: true }
  });

  await win.loadFile(path.join(ROOT, 'odometer-preview.html'));
  await win.webContents.insertCSS(FREEZE_CSS);
  await win.webContents.executeJavaScript(`
    document.getElementById('birthDate').value = '2004-10-23';
    document.getElementById('expectedAge').value = '80';
    true;
  `);
  await new Promise(r => setTimeout(r, 1200));

  // ---- 端到端核对 ----
  const res = await win.webContents.executeJavaScript(CHECK_REELS);
  console.log('数据源: 2004-10-23 / 80 岁   剩余', res.days, '天');
  console.log('逐根滚轮核对（transform 反推格号 → 读该格数字）:');
  res.rows.forEach(r => {
    console.log(`  ${r.place.padEnd(8)} 圈长 ${String(r.cycle).padStart(2)}  ` +
      `停在第 ${String(r.offset).padStart(2)} 格  显示 ${r.shown}  期望 ${r.expect}  ${r.ok ? 'OK' : '错位!'}`);
  });
  const allOk = res.rows.every(r => r.ok);
  console.log('  6 根滚轮全部对上:', allOk);

  // ---- 版式体检：nowrap 实测宽 vs 可用宽 ----
  const widths = [1280, 1100, 1000, 900, 860, 760, 660, 560];
  console.log('\n整行版式体检（nowrap 实测宽 vs 卡片可用宽）:');
  let allFit = true;
  for (const w of widths) {
    win.setContentSize(w, 860);
    await new Promise(r => setTimeout(r, 250));
    const m = await win.webContents.executeJavaScript(CHECK_REELS);
    const fit = m.nowrapW <= m.availW + 1;
    if (!fit) allFit = false;
    console.log(`  ${String(w).padStart(4)}px  需 ${String(m.nowrapW).padStart(4)} / 可用 ${String(m.availW).padStart(4)}  ` +
      `${fit ? '单行' : '溢出!'}  行高 ${m.rowH}  数字 ${m.digitPx}`);
  }
  console.log('  全部单行不溢出:', allFit);

  // ---- 截图 ----
  const shoot = async (w, h, light, file) => {
    win.setContentSize(w, h);
    await win.webContents.executeJavaScript(
      `document.body.classList.toggle('light-mode', ${light}); true`);
    await new Promise(r => setTimeout(r, 800));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(DOCS, file), img.toPNG());
    console.log('  写入', file, fs.statSync(path.join(DOCS, file)).size, 'bytes');
  };

  await shoot(1280, 900, false, 'odometer-dark.png');
  await shoot(1280, 900, true, 'odometer-light.png');

  // 模拟「滚到一半」：把秒的两根滚轮各推半格，看两数字各露一半的样子
  await win.webContents.executeJavaScript(`
    (() => {
      document.body.classList.remove('light-mode');
      const reels = [...document.querySelectorAll('.reel')];
      [reels[4], reels[5]].forEach(reel => {
        const track = reel.querySelector('.reel-track');
        const cellH = reel.getBoundingClientRect().height;
        const ty = new DOMMatrix(getComputedStyle(track).transform).m42;
        track.style.transition = 'none';
        track.style.transform = 'translateY(' + (ty - cellH * 0.55) + 'px)';
      });
      return true;
    })()
  `);
  await new Promise(r => setTimeout(r, 300));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(DOCS, 'odometer-rolling.png'), img.toPNG());
  console.log('  写入 odometer-rolling.png', fs.statSync(path.join(DOCS, 'odometer-rolling.png')).size, 'bytes');

  app.exit(allOk && allFit ? 0 : 2);
}).catch(e => { console.error('FAILED:', e); app.exit(1); });
