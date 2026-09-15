/**
 * 生成 README 用的界面截图（docs/screenshot.png），并顺带做一次
 * 「读秒行不溢出」的版式体检。亮色态只做自检、不落盘。
 *
 * 需要在有图形界面的环境跑（Electron 起窗口）。用法：
 *   npm run shot
 *
 * 三个坑（都在本文件里处理掉了，改脚本时别删）：
 *  1. 环境若带 ELECTRON_RUN_AS_NODE=1，electron 会退化成纯 Node，
 *     表现为 require('electron').app === undefined。这层已由
 *     scripts/electron-run.mjs 垫片统一擦掉，不用再手动 unset。
 *  2. 窗口 show:false 时，CSS transition 的动画时间线是冻结的 ——
 *     getComputedStyle 会一直返回过渡的起始值，capturePage 也拿到旧帧。
 *     所以截图前先注入一段禁用 transition/animation 的样式。
 *  3. 同样是隐藏窗口：改了样式之后合成器不保证马上吐新帧，capturePage 可能
 *     返回上一张 —— 现象是「明明切了亮色，截出来还是暗的」，而 getComputedStyle
 *     说已经切了。解法：invalidate() + 等几帧 + 用角落像素自检，不对就重试。
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');

// 关掉过渡与动画：让每张截图都是「终态」，可复现
const FREEZE_CSS = `*, *::before, *::after {
  transition: none !important;
  animation: none !important;
}`;

const FILL_FORM = `
  (() => {
    window.alert = () => {};
    document.getElementById('birthDate').value = '2004-10-23';
    document.getElementById('expectedAge').value = '80';
    startCountdown();
    return true;
  })()
`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: {
      backgroundThrottling: false,   // 隐藏窗口也要跑 rAF（心跳线靠它）
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  await win.loadFile(path.join(ROOT, 'index.html'));
  await win.webContents.insertCSS(FREEZE_CSS);
  await win.webContents.executeJavaScript(FILL_FORM);

  // 让心跳线跑出几拍墨迹
  await new Promise(r => setTimeout(r, 9000));

  // 版式体检：滚轮行是固定格宽 + flex-wrap，塞不下会换行 —— 要真量
  // 档位刻意加密在媒体查询边界两侧（982/881/661/621/521），那里最容易出缝
  const widths = [1280, 1100, 1000, 982, 950, 900, 881, 860, 700, 661, 660, 621, 620, 560, 521, 440, 375];

  // 改完尺寸后先确认视口真的动了。有些环境（无窗口管理器的沙箱 / 远程桌面 / 某些 CI）
  // 会静默忽略 setContentSize —— 于是「量下一档」时视口还停在上一个宽度上，
  // 读数看起来却特别像真的。这里带重试：确认生效才量，实在确认不了就标跳过。
  // （"验不了"不等于"通过"；但也不该直接放弃，所以先重试。）
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

  const fits = [];
  for (const w of widths) {
    const vw = await resizeTo(w, 800);
    if (Math.abs(vw - w) > 2) { fits.push({ win: w, vw }); continue; }
    const row = await win.webContents.executeJavaScript(`
      (() => {
        const rowEl  = document.getElementById('odoRow');
        const num    = rowEl.querySelector('.odo-num');
        const availW = rowEl.clientWidth;
        const cellH  = num.getBoundingClientRect().height;   // = 1.25 × 数字字号

        // 不换行时到底要多宽？克隆一份、把 flex-wrap 关掉再量（块宽/range 都会被布局骗到）
        const probe = rowEl.cloneNode(true);
        probe.style.cssText =
          'position:absolute;left:-9999px;top:0;visibility:hidden;' +
          'width:auto;flex-wrap:nowrap;';
        document.body.appendChild(probe);
        const nowrapW = probe.getBoundingClientRect().width;
        probe.remove();

        const rowH = rowEl.getBoundingClientRect().height;

        // tabular-nums 是否真的生效：等宽数字下 11111 与 88888 应该一样宽
        const j = document.createElement('span');
        j.style.cssText = 'position:absolute;left:-9999px;font:' +
          getComputedStyle(num).font + ';font-variant-numeric:tabular-nums;';
        document.body.appendChild(j);
        j.textContent = '11111'; const w1 = j.getBoundingClientRect().width;
        j.textContent = '88888'; const w8 = j.getBoundingClientRect().width;
        j.remove();

        return {
          win: ${w},
          vw: window.innerWidth,          // ← 视口自检：确认这一行是在请求的宽度上量的
          overflowPx: Math.round(rowEl.scrollWidth - rowEl.clientWidth),
          nowrapW: Math.round(nowrapW),
          availW: Math.round(availW),
          wrap: nowrapW > availW + 1,
          rows: cellH > 0 ? Math.round(rowH / cellH) : 0,
          digitPx: getComputedStyle(num).fontSize,
          yearPx: getComputedStyle(document.getElementById('passedYears')).fontSize,
          tabular: Math.abs(w1 - w8) < 0.5,
          digitDelta: +(w8 - w1).toFixed(2)
        };
      })()
    `);
    fits.push(row);
  }
  console.log('滚轮读秒行版式体检（nowrap 实测宽 vs 可用宽）:');
  // ⚠️ 先自检「这一行是不是在它该在的宽度上量的」。有些环境会【静默忽略】setContentSize
  // （无窗口管理器的沙箱 / 远程桌面 / 某些 CI），视口停在上一个宽度上，
  // 读数看起来却特别像真的溢出。尺寸没生效的那档直接跳过，且不允许它把结论带偏。
  fits.forEach(f => {
    if (Math.abs(f.vw - f.win) > 2) {
      f.stale = true;
      console.log(`  ${String(f.win).padStart(4)}px  SKIP  尺寸未生效（视口仍是 ${f.vw}px），这一档不算数`);
      return;
    }
    console.log(`  ${String(f.win).padStart(4)}px  ` +
      `需 ${String(f.nowrapW).padStart(4)} / 可用 ${String(f.availW).padStart(4)}  ` +
      `${f.wrap ? '换行!' : '单行 '}  ${f.rows} 行  溢出 ${String(f.overflowPx).padStart(3)}px  ` +
      `数字 ${f.digitPx}  年份 ${f.yearPx}`);
  });
  const real = fits.filter(f => !f.stale);
  const staleCount = fits.length - real.length;
  const allFit = real.length > 0 && real.every(f => !f.wrap && f.rows <= 1 && f.overflowPx <= 0);
  console.log(`  实测 ${real.length} 档` + (staleCount ? `，跳过 ${staleCount} 档` : '') +
    `　全部单行、不换行、不溢出: ${allFit}` +
    (real.length === 0 ? '  ⚠️ 一档都没量到：本环境不支持窗口缩放，结论不可信' : ''));
  console.log('  tabular-nums 等宽生效:', real[0] ? real[0].tabular : '(无量到的档)',
    real[0] ? '(88888-11111 = ' + real[0].digitDelta + 'px)' : '');

  // 角落像素平均亮度：暗色主题背景是 #0a0e1a（≈17），亮色是 #f5f7fa（≈246）
  const cornerLuma = (img) => {
    const b = img.getBitmap();                       // BGRA
    const i = (4 * img.getSize().width + 4) * 4;
    return (b[i] + b[i + 1] + b[i + 2]) / 3;
  };

  const shoot = async (w, h, light, file) => {
    win.setContentSize(w, h);
    await win.webContents.executeJavaScript(
      `document.body.classList.toggle('light-mode', ${light}); true`
    );

    // 坑 3：窗口 show:false 时改了样式，合成器不一定吐新帧 ——
    // capturePage 可能返回上一张（现象就是「明明切了亮色，截出来还是暗的」，
    // 而 getComputedStyle 说已经切了）。所以要主动 invalidate + 等几帧，
    // 再用角落像素自检，不对就重试。
    let img = null, luma = 0, tries = 0;
    while (tries++ < 5) {
      win.webContents.invalidate();
      await win.webContents.executeJavaScript(`
        new Promise(res => { let n = 0;
          const tick = () => (++n >= 4 ? res(true) : requestAnimationFrame(tick));
          requestAnimationFrame(tick); })
      `);
      await new Promise(r => setTimeout(r, 250));
      img = await win.webContents.capturePage();
      luma = cornerLuma(img);
      if ((luma > 128) === light) break;
    }

    // file 传 null = 只做自检、不落盘（亮色态就是这样）
    const ok = (luma > 128) === light;
    if (file) {
      fs.writeFileSync(path.join(DOCS, file), img.toPNG());
      console.log(`  写入 ${file} ${fs.statSync(path.join(DOCS, file)).size} bytes  ` +
        `角落亮度 ${luma.toFixed(0)} 期望${light ? '亮' : '暗'}  ${ok ? 'OK' : '仍不对!'}` +
        (tries > 1 ? `（重试 ${tries - 1} 次才拿到新帧）` : ''));
    } else {
      console.log(`  亮色态自检（不落盘）  角落亮度 ${luma.toFixed(0)} 期望亮  ${ok ? 'OK' : '仍不对!'}` +
        (tries > 1 ? `（重试 ${tries - 1} 次）` : ''));
    }
    return ok;
  };

  const shotDark = await shoot(1280, 900, false, 'screenshot.png');
  // 亮色态照样跑一遍 —— 主题切换是否真的生效、隐藏窗口的旧帧自检，都靠它；
  // 但不再写文件：README 只展示暗色那张，仓库里不留没人看的图（省 500 多 KB）。
  const shotLight = await shoot(1280, 900, true, null);

  app.exit(allFit && shotDark && shotLight ? 0 : 2);
}).catch(e => { console.error('FAILED:', e); app.exit(1); });
