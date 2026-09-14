/**
 * 生成 README 用的界面截图，并顺带做一次「读秒行不溢出」的版式体检。
 *
 * 需要在有图形界面的环境跑（Electron 起窗口）。用法：
 *   npm run shot
 *
 * 三个坑（都在本文件里处理掉了，改脚本时别删）：
 *  1. 环境若带 ELECTRON_RUN_AS_NODE=1，electron 会退化成纯 Node，
 *     表现为 require('electron').app === undefined。启动命令里要 unset 掉。
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
  const fits = [];
  for (const w of widths) {
    win.setContentSize(w, 800);
    await new Promise(r => setTimeout(r, 400));
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
  fits.forEach(f => {
    console.log(`  ${String(f.win).padStart(4)}px  ` +
      `需 ${String(f.nowrapW).padStart(4)} / 可用 ${String(f.availW).padStart(4)}  ` +
      `${f.wrap ? '换行!' : '单行 '}  ${f.rows} 行  溢出 ${String(f.overflowPx).padStart(3)}px  ` +
      `数字 ${f.digitPx}  年份 ${f.yearPx}`);
  });
  const allFit = fits.every(f => !f.wrap && f.rows <= 1 && f.overflowPx <= 0);
  console.log('  全部单行、不换行、不溢出:', allFit);
  console.log('  tabular-nums 等宽生效:', fits[0].tabular,
    '(88888-11111 =', fits[0].digitDelta + 'px)');

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

    fs.writeFileSync(path.join(DOCS, file), img.toPNG());
    const ok = (luma > 128) === light;
    console.log(`  写入 ${file} ${fs.statSync(path.join(DOCS, file)).size} bytes  ` +
      `角落亮度 ${luma.toFixed(0)} 期望${light ? '亮' : '暗'}  ${ok ? 'OK' : '仍不对!'}` +
      (tries > 1 ? `（重试 ${tries - 1} 次才拿到新帧）` : ''));
    return ok;
  };

  const shotDark = await shoot(1280, 900, false, 'screenshot.png');
  const shotLight = await shoot(1280, 900, true, 'screenshot-light.png');

  app.exit(allFit && shotDark && shotLight ? 0 : 2);
}).catch(e => { console.error('FAILED:', e); app.exit(1); });
