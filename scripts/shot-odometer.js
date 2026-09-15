/**
 * 滚轮读秒预览页的截图 + 端到端核对（开发用）。
 *
 *   npm run shot:odo          （等价于 node scripts/electron-run.mjs scripts/shot-odometer.js）
 *
 * 产出 docs/odometer-rolling.png（「滚到一半」那张），其余静态变体不再写盘。
 *
 * 两个坑：
 *  1. 环境若带 ELECTRON_RUN_AS_NODE=1，electron 会退化成纯 Node —— 
 *     所以走 scripts/electron-run.mjs 这层垫片，它会替你擦掉那个变量
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
      vw: window.innerWidth,          // ← 视口自检用：确认这一轮是在本次请求的宽度上量的
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
  // ⚠️ 每量一档都要先自检「视口是否真的改过去了」。
  // 有些环境（无窗口管理器的沙箱 / 远程桌面 / 某些 CI）会【静默忽略】setContentSize，
  // 于是你以为在量 660px，其实视口还停在 760px —— 读数全是假的，
  // 而它看起来又特别像「真的溢出了」。踩过：求 1100 得 1280、求 860 得 1000、求 660 得 760。
  // 档位刻意加密在预览页两个断点两侧（881/880、621/620），
  // 以及「连续钳制刚接手、字号还没降够」的那段窄带（976~900）—— 那里最容易出缝
  const widths = [1280, 1100, 1000, 976, 940, 900, 881, 880, 860, 760, 661, 660, 621, 620, 560];

  // 改完尺寸先确认视口真的动了，确认不了就重试（原因见下）
  const resizeTo = async (w, h) => {
    let vw = 0;
    for (let i = 0; i < 4; i++) {
      win.setContentSize(w, h);
      await new Promise(r => setTimeout(r, 300 + i * 200));
      vw = await win.webContents.executeJavaScript('window.innerWidth');
      if (Math.abs(vw - w) <= 2) break;
    }
    return vw;
  };

  console.log('\n整行版式体检（nowrap 实测宽 vs 卡片可用宽）:');
  let allFit = true, measured = 0;
  const skipped = [];
  for (const w of widths) {
    await resizeTo(w, 860);
    const m = await win.webContents.executeJavaScript(CHECK_REELS);
    if (Math.abs(m.vw - w) > 2) {
      skipped.push(`${w}→${m.vw}`);
      console.log(`  ${String(w).padStart(4)}px  SKIP  尺寸未生效（视口仍是 ${m.vw}px），这一档不算数`);
      continue;
    }
    measured++;
    const fit = m.nowrapW <= m.availW + 1;
    if (!fit) allFit = false;
    console.log(`  ${String(w).padStart(4)}px  需 ${String(m.nowrapW).padStart(4)} / 可用 ${String(m.availW).padStart(4)}  ` +
      `${fit ? '单行' : '溢出!'}  行高 ${m.rowH}  数字 ${m.digitPx}`);
  }
  console.log(`  实测 ${measured} 档` +
    (skipped.length ? `，跳过 ${skipped.length} 档（${skipped.join('  ')}）` : '') +
    `　全部单行不溢出: ${allFit}` +
    (measured === 0 ? '  ⚠️ 一档都没量到：本环境不支持窗口缩放，结论不可信' : ''));

  // ---- 截图：只留「滚到一半」这一张 ----
  // 静态的暗/亮变体不再写进仓库（README 只展示滚动中这一张，它最能说明「是滚轮」）。
  //
  // ⚠️ 这一张是【伪造】出来的：手动把秒的两根滚带各推半格。
  // 时序很要命 —— 预览页每秒都会重画秒位，你若正好在它重画那一瞬推格，
  // 不到一拍就被它改回去，截出来是一排好好的整数（看着像"滚得很整齐"，其实根本没滚）。
  // 所以先等它"刚翻完一拍"，再推格截图：这一拍剩下的 ~900ms 是安全窗口。
  // 先回到正常窗口尺寸再截 —— 前面版式体检把窗口一路缩到了 560px。
  // 这里也走带重试的 resizeTo，免得这环境里尺寸没生效、就截了一张小图。
  await resizeTo(1280, 900);
  await new Promise(r => setTimeout(r, 300));

  // 等它「刚翻完一拍」：这一拍剩下的 ~900ms 里预览页不会重画秒位，
  // 就在这个窗口里伪造「滚到一半」。
  const secOf = () => win.webContents.executeJavaScript('readParts().seconds');
  const s0 = await secOf();
  for (let i = 0; i < 80 && (await secOf()) === s0; i++) {
    await new Promise(r => setTimeout(r, 20));
  }

  // ⚠️ 隐藏窗口里 capturePage() 拿到的可能是旧帧 —— 实测：DOM 里偏移明明已经是
  // 1.55 格（停在两格之间），截出来却是一排好好的整数。所以这里把窗口【短暂显示】
  // 出来，合成器开始出帧，才截得到真实画面。
  // （也不能用 requestAnimationFrame 等帧：隐藏窗口 rAF 被节流到 ~1fps，
  //   一等等好几秒，秒位早被重画回去了。）
  win.showInactive();
  await new Promise(r => setTimeout(r, 250));
  const baseImg = await win.webContents.capturePage();

  // 伪造「滚到一半」：把秒的十位与个位各推半格
  await win.webContents.executeJavaScript(`
    (() => {
      document.body.classList.remove('light-mode');
      const reels = [...document.querySelectorAll('.reel')];
      [reels[4], reels[5]].forEach(reel => {        // 4/5 = 秒的十位与个位
        const track = reel.querySelector('.reel-track');
        const cellH = reel.getBoundingClientRect().height;
        const ty = new DOMMatrix(getComputedStyle(track).transform).m42;
        track.style.transition = 'none';
        track.style.transform = 'translateY(' + (ty - cellH * 0.55) + 'px)';
      });
      return true;
    })()
  `);
  await new Promise(r => setTimeout(r, 150));
  const img = await win.webContents.capturePage();
  win.hide();

  // 自检 A：DOM 里的偏移应是「带小数」的（真的停在两格之间）。整数 = 被重画回去了。
  const offs = await win.webContents.executeJavaScript(`
    (() => [...document.querySelectorAll('.reel')].slice(4, 6).map(reel => {
      const track = reel.querySelector('.reel-track');
      const cellH = reel.getBoundingClientRect().height || 1;
      return +(new DOMMatrix(getComputedStyle(track).transform).m42 / -cellH).toFixed(3);
    }))()
  `);
  const betweenCells = offs.length === 2 && offs.every(o => Math.abs(o - Math.round(o)) > 0.05);
  console.log(`  秒位偏移 ${offs.join(' / ')} 格  ` +
    `${betweenCells ? 'OK（停两格之间）' : '⚠️ 是整数 = 被重画回去了'}`);

  // 自检 B：图里必须真的变了 —— 拿推格前 / 推格后两张图做像素对比。
  // 判据：**旧帧会给出恰好 0%**（同一张位图逐字节相同），所以门槛贴着 0 放就行；
  // 秒位那两个数字只占画面约 1%，差异本来就只有零点几个百分点，别拍脑袋定成 0.5%
  // （第一版就是这么拍的，结果把真变化判成了旧帧 —— 又一次"尺子错"）。
  const diffRatio = (a, b) => {
    if (!a || !b || a.length !== b.length) return 1;
    let d = 0, n = 0;
    for (let i = 0; i < a.length; i += 12) { n++; if (Math.abs(a[i] - b[i]) > 8) d++; }
    return d / n;
  };
  const ratio = diffRatio(baseImg.getBitmap(), img.getBitmap());
  const frameFresh = ratio > 0.001;
  console.log(`  推格前后画面对比：差异像素 ${(ratio * 100).toFixed(3)}%  ` +
    `${frameFresh ? 'OK（不是同一张位图 = 画面真的变了）' : '⚠️ 差异≈0 = capturePage 给的是旧帧!'}`);

  fs.writeFileSync(path.join(DOCS, 'odometer-rolling.png'), img.toPNG());
  console.log('  写入 odometer-rolling.png', fs.statSync(path.join(DOCS, 'odometer-rolling.png')).size, 'bytes');

  // 一档都没量到 = 本环境验不了版式 → 也算不通过（"验不了"不等于"通过"）
  app.exit(allOk && allFit && measured > 0 && betweenCells && frameFresh ? 0 : 2);
}).catch(e => { console.error('FAILED:', e); app.exit(1); });
