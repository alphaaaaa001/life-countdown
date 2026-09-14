/**
 * 生成 README 用的界面截图，并顺带做一次「读秒行不溢出」的版式体检。
 *
 * 需要在有图形界面的环境跑（Electron 起窗口）。用法：
 *   npm run shot
 *
 * 两个坑（都在本文件里处理掉了，改脚本时别删）：
 *  1. 环境若带 ELECTRON_RUN_AS_NODE=1，electron 会退化成纯 Node，
 *     表现为 require('electron').app === undefined。启动命令里要 unset 掉。
 *  2. 窗口 show:false 时，CSS transition 的动画时间线是冻结的 ——
 *     getComputedStyle 会一直返回过渡的起始值，capturePage 也拿到旧帧。
 *     所以截图前先注入一段禁用 transition/animation 的样式。
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

  // 版式体检：文字真实宽度要用 Range 量，元素块宽会骗人
  const widths = [1280, 1100, 1000, 900, 860, 700, 620, 560];
  const fits = [];
  for (const w of widths) {
    win.setContentSize(w, 800);
    await new Promise(r => setTimeout(r, 400));
    const row = await win.webContents.executeJavaScript(`
      (() => {
        const group = document.querySelector('.stat-value-group');
        const num   = document.getElementById('daysToEnd');
        const availW = group.getBoundingClientRect().width;

        // 不换行时到底要多宽？用 nowrap 探针量，range/块宽都会被布局骗到
        const probe = group.cloneNode(true);
        probe.style.cssText =
          'position:absolute;left:-9999px;top:0;visibility:hidden;' +
          'white-space:nowrap;width:auto;display:inline-block;';
        document.body.appendChild(probe);
        const nowrapW = probe.getBoundingClientRect().width;
        probe.remove();

        // tabular-nums 是否真的生效：等宽数字下 11111 与 88888 应该一样宽
        const j = document.createElement('span');
        j.style.cssText = getComputedStyle(num).cssText;
        j.style.position = 'absolute'; j.style.left = '-9999px';
        j.style.fontVariantNumeric = 'tabular-nums';
        document.body.appendChild(j);
        j.textContent = '11111'; const w1 = j.getBoundingClientRect().width;
        j.textContent = '88888'; const w8 = j.getBoundingClientRect().width;
        j.remove();

        return {
          win: ${w},
          nowrapW: Math.round(nowrapW),
          availW: Math.round(availW),
          wrap: nowrapW > availW + 1,
          numPx: getComputedStyle(num).fontSize,
          yearPx: getComputedStyle(document.getElementById('passedYears')).fontSize,
          tabular: Math.abs(w1 - w8) < 0.5,
          digitDelta: +(w8 - w1).toFixed(2)
        };
      })()
    `);
    fits.push(row);
  }
  console.log('读秒行版式体检（nowrap 实测宽 vs 可用宽）:');
  fits.forEach(f => {
    console.log(`  ${String(f.win).padStart(4)}px  ` +
      `需 ${String(f.nowrapW).padStart(4)} / 可用 ${String(f.availW).padStart(3)}  ` +
      `${f.wrap ? '换行!' : '单行 '}  数字 ${f.numPx}  年份 ${f.yearPx}`);
  });
  const allFit = fits.every(f => !f.wrap);
  console.log('  全部单行不换行:', allFit);
  console.log('  tabular-nums 等宽生效:', fits[0].tabular,
    '(88888-11111 =', fits[0].digitDelta + 'px)');

  const shoot = async (w, h, light, file) => {
    win.setContentSize(w, h);
    await win.webContents.executeJavaScript(
      `document.body.classList.toggle('light-mode', ${light}); true`
    );
    await new Promise(r => setTimeout(r, 1500));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(DOCS, file), img.toPNG());
    console.log('  写入', file, fs.statSync(path.join(DOCS, file)).size, 'bytes');
  };

  await shoot(1280, 900, false, 'screenshot.png');
  await shoot(1280, 900, true,  'screenshot-light.png');

  app.exit(allFit ? 0 : 2);
}).catch(e => { console.error('FAILED:', e); app.exit(1); });
