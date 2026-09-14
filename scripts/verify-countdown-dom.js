/**
 * 正式版 DOM 逐实例核对：在真渲染进程里跑 index.html，把每根滚轮
 * 【当前显示的数字】跟【真实读数】逐拍比。
 *
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron.exe scripts/verify-countdown-dom.js
 *
 * 为什么需要它：verify-odometer.mjs 验的是纯函数与状态机的复刻件，
 * 而「滚轮真的接到了 updateCountdown 上」「节拍真的对齐整秒」「CSS 变量真的生效」
 * 属于接线层，只能靠真渲染进程量。
 *
 * ⚠️ 两个 Electron 隐藏窗口的坑（这也是本脚本分两段跑的原因）：
 *  1. show:false 时 requestAnimationFrame 被节流到约 1fps —— 所以采样用 setTimeout。
 *  2. show:false 时 CSS 过渡的时间线不推进（实测滚动占比恒为 0%），
 *     读数永远停在旧格上。所以：
 *       [2] 段用「禁过渡」把状态变成瞬时的 → 确定性地核对接线是否正确；
 *       [3] 段把窗口**短暂显示**出来，让动画真的跑 → 核对动画态下的显示是否正确。
 *     第 3 段会弹出一个窗口约 6 秒，属正常现象。
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BIRTH = '2004-10-23';
const AGE = 80;

const FREEZE_CSS = `*, *::before, *::after {
  transition: none !important;
  animation: none !important;
}`;

// 与页面同款规则推出终点：出生年 + 寿命，本地 00:00（东八区下即 2084-10-23 00:00）
const END = new Date(2084, 9, 23);

// 独立算一遍真值（不调用页面里的函数，避免"拿实现验实现"）
function expectParts(nowMs) {
  const left = END.getTime() - nowMs;
  if (left <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  return {
    days: Math.floor(left / 86400000),
    hours: Math.floor((left % 86400000) / 3600000),
    minutes: Math.floor((left % 3600000) / 60000),
    seconds: Math.floor((left % 60000) / 1000)
  };
}
const expectDigitOf = (want, group, idx) =>
  Number(String(want[group]).padStart(2, '0')[1 - idx]);

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? '  ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  ' + detail : ''}`); }
};

// 渲染进程里的采样器：读出每根滚轮当前显示的数字
const SAMPLER = (ms, step) => `
new Promise(resolve => {
  const out = [];
  const t0 = performance.now();
  const tick = () => {
    const now = Date.now();
    const rows = odoReels.map(r => {
      const ts = getComputedStyle(r.track).transform;
      const cell = parseFloat(getComputedStyle(r.reel).fontSize) * 1.25;
      const off = ts === 'none' ? 0 : -new DOMMatrixReadOnly(ts).m42 / cell;
      const near = Math.round(off);
      const idx = ((near % r.cycle) + r.cycle) % r.cycle;
      return { group: r.group, idx: r.idx, cycle: r.cycle,
               settled: Math.abs(off - near) < 0.02, shown: odoCellDigit(idx, r.cycle) };
    });
    out.push({ t: now, days: odoDaysEl.textContent, reels: rows });
    if (performance.now() - t0 < ${ms}) setTimeout(tick, ${step});
    else resolve(out);
  };
  setTimeout(tick, ${step});
})
`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1000, height: 800, show: false, center: true, focusable: true,
    webPreferences: { backgroundThrottling: false }
  });

  const errors = [];
  win.webContents.on('console-message', (e, level, message) => {
    if (message && !message.includes('Security Warning')) errors.push(message);
  });

  await win.loadFile(path.join(ROOT, 'index.html'));

  await win.webContents.executeJavaScript(`
    window.alert = () => {}; window.confirm = () => true;
    document.getElementById('birthDate').value = '${BIRTH}';
    document.getElementById('expectedAge').value = '${AGE}';
    startCountdown();
    true;
  `);

  // ============================================================
  console.log('[1] 接线层');
  const wiring = await win.webContents.executeJavaScript(`
    (() => {
      const row = document.getElementById('odoRow');
      const reels = [...row.querySelectorAll('.reel')];
      const t0 = getComputedStyle(reels[0].querySelector('.reel-track'));
      return {
        reelCount: reels.length,
        cycles: reels.map(r => r.querySelectorAll('.reel-track > i').length / 2),
        hasDays: !!row.querySelector('.odo-num'),
        dur: t0.transitionDuration,
        ease: t0.transitionTimingFunction,
        digitPx: getComputedStyle(row.querySelector('.odo-num')).fontSize,
        sectionVisible: !document.getElementById('countdownSection').classList.contains('hidden')
      };
    })()
  `);
  ok('倒计时区块已显示', wiring.sectionVisible);
  ok('6 根滚轮（时/分/秒 各两位）', wiring.reelCount === 6, `实得 ${wiring.reelCount}`);
  ok('天数是静态数字节点', wiring.hasDays);
  ok('圈长 = [3,10,6,10,6,10]（时十位 3 格、分/秒十位 6 格）',
    JSON.stringify(wiring.cycles) === JSON.stringify([3, 10, 6, 10, 6, 10]),
    JSON.stringify(wiring.cycles));
  ok('滚动时长真的生效 600ms', wiring.dur === '0.6s', wiring.dur);
  ok('缓动曲线真的生效（平滑）', /0\.22,\s*0\.61,\s*0\.36,\s*1/.test(wiring.ease), wiring.ease);
  ok('数字字号 80px（窄窗口自适应钳制允许 ≤2% 收紧）',
    parseFloat(wiring.digitPx) >= 78 && parseFloat(wiring.digitPx) <= 80.001, wiring.digitPx);

  // ============================================================
  // [2] 禁过渡 → 状态瞬时。确定性地核对接线：每一拍的目标值都必须等于真值。
  // ⚠️ 这段样式必须在上面的 [1] 段读完之后再插：它会把 transition 压成 0s，
  //    提前插的话 [1] 段量到的「滚动时长 600ms」就是在量一个假值。
  const freezeKey = await win.webContents.insertCSS(FREEZE_CSS);
  console.log('\n[2] 确定性核对（隐藏窗口 + 禁过渡，采样 5s）');
  const fixed = await win.webContents.executeJavaScript(SAMPLER(5000, 25));
  {
    let checked = 0, bad = [];
    for (const s of fixed) {
      const into = s.t % 1000;
      if (into < 120 || into > 960) continue;      // 整秒边界附近：这一拍可能还没落到
      const want = expectParts(s.t);
      if (String(want.days) !== s.days) bad.push(`${s.t}: 天 显示${s.days} 期望${want.days}`);
      for (const r of s.reels) {
        const exp = expectDigitOf(want, r.group, r.idx);
        if (r.shown !== exp) bad.push(`${s.t}: ${r.group}${r.idx} 显示${r.shown} 期望${exp}`);
      }
      checked++;
    }
    console.log(`  采样 ${fixed.length} 帧，其中 ${checked} 帧落在「该翻牌之后」`);
    ok('接线正确：目标值 100% 等于真实读数', bad.length === 0,
      bad.slice(0, 3).join(' | ') || `核对了 ${checked} 帧 × 6 根滚轮`);
  }

  // ============================================================
  // [3] 打开过渡并把窗口显示出来，让动画真的跑。会弹窗约 6 秒。
  console.log('\n[3] 动画态核对（可见窗口，会让动画真跑 —— 会短暂弹出一个窗口）');
  await win.webContents.removeInsertedCSS(freezeKey);
  win.showInactive();
  await new Promise(r => setTimeout(r, 800));

  const live = await win.webContents.executeJavaScript(SAMPLER(6000, 25));
  {
    const stats = {};
    for (const r of live[0].reels) stats[r.group + r.idx] = { settled: 0, rolling: 0, bad: [] };
    let daysBad = [], checked = 0;

    for (const s of live) {
      const into = s.t % 1000;
      const nearBoundary = into < 35 || into > 965;
      const want = expectParts(s.t);
      if (String(want.days) !== s.days) daysBad.push(`${s.t}: 显示${s.days} 期望${want.days}`);
      for (const r of s.reels) {
        const st = stats[r.group + r.idx];
        if (!r.settled) { st.rolling++; continue; }
        st.settled++;
        const exp = expectDigitOf(want, r.group, r.idx);
        if (r.shown !== exp && !nearBoundary) st.bad.push(`${s.t}: 显示${r.shown} 期望${exp}`);
        if (!nearBoundary) checked++;
      }
    }

    const allBad = Object.entries(stats).flatMap(([k, s]) => s.bad.map(b => k + ' ' + b));
    const s0 = stats.seconds0;
    const rollPct = 100 * s0.rolling / (s0.settled + s0.rolling);
    console.log(`  采样 ${live.length} 帧（${(live.length / 6).toFixed(0)} fps）` +
      `，秒个位滚动占比 ${rollPct.toFixed(0)}%，累计核对 ${checked} 个停稳样本`);

    ok('动画态下停稳显示的数字 == 真实数字（0 次例外）', allBad.length === 0,
      allBad.slice(0, 3).join(' | '));
    ok('秒个位确实在滚（动画没被冻住）', rollPct > 10, `${rollPct.toFixed(0)}%`);
    ok('滚动停得下来（停稳占比 > 50%，说明 600ms 内跑完了一拍）',
      100 - rollPct > 50, `停稳 ${(100 - rollPct).toFixed(0)}%`);
    ok('天数始终正确', daysBad.length === 0, daysBad.slice(0, 2).join(' | '));
    ok('渲染进程无报错', errors.length === 0, errors.slice(0, 2).join(' | '));

    // ----------------------------------------------------------
    console.log('\n[4] 翻牌时刻是否落在整秒边界上');
    // 用 [2] 段的样本量相位最干净（禁过渡 → 状态何时变 == 节拍何时到）
    const changes = [];
    let prev = null;
    for (const s of fixed) {
      const sec = s.reels.find(r => r.group === 'seconds' && r.idx === 0).shown;
      if (prev !== null && sec !== prev) changes.push(s.t);
      prev = sec;
    }
    const phases = changes.map(t => Math.min(t % 1000, 1000 - (t % 1000)));
    ok('检出秒的翻牌（样本足够长）', changes.length >= 3, `${changes.length} 次`);
    ok('每次翻牌都贴着整秒边界（±120ms 内）', phases.every(p => p <= 120),
      `最大相位偏移 ${phases.length ? Math.max(...phases) : -1}ms`);
  }

  win.hide();
  console.log(`\n合计 ${pass + fail} 条：${pass} PASS / ${fail} FAIL`);
  app.exit(fail ? 1 : 0);
}).catch(e => { console.error('FAILED:', e); app.exit(1); });
