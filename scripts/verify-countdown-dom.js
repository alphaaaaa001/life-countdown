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
// 年份行：终点 = 次年 1/1 本地时间。**小时是总小时数**（0..8784），不是 0-23。
function expectYearParts(nowMs) {
  const d = new Date(nowMs);
  const left = new Date(d.getFullYear() + 1, 0, 1).getTime() - nowMs;
  if (left <= 0) return { hours: 0, minutes: 0, seconds: 0 };
  return {
    hours: Math.floor(left / 3600000),
    minutes: Math.floor((left % 3600000) / 60000),
    seconds: Math.floor((left % 60000) / 1000)
  };
}
// 某行某一位的期望数字：digits = 该字段补几位（生命行小时 2 位，年份行小时 4 位）
const expectDigitOf = (want, key, idx, digits) =>
  Number(String(want[key]).padStart(digits, '0')[digits - 1 - idx]);

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? '  ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  ' + detail : ''}`); }
};

// 渲染进程里的采样器：逐行读出每根滚轮当前显示的数字。
// 2026-09-17 起读数层改成「多行注册表」（odoRows），且隐藏的那一行不采。
const SAMPLER = (ms, step) => `
new Promise(resolve => {
  const out = [];
  const t0 = performance.now();
  const readRow = (name) => {
    const rec = odoRows[name];
    if (!rec || rec.el.classList.contains('hidden')) return null;
    return {
      days: rec.daysEl ? rec.daysEl.textContent : null,
      reels: rec.reels.map(r => {
        const ts = getComputedStyle(r.track).transform;
        const cell = parseFloat(getComputedStyle(r.reel).fontSize) * 1.25;
        const off = ts === 'none' ? 0 : -new DOMMatrixReadOnly(ts).m42 / cell;
        const near = Math.round(off);
        const idx = ((near % r.cycle) + r.cycle) % r.cycle;
        return { row: name, key: r.key, idx: r.idx, digits: r.digits, cycle: r.cycle,
                 settled: Math.abs(off - near) < 0.02, shown: odoCellDigit(idx, r.cycle) };
      })
    };
  };
  const tick = () => {
    out.push({ t: Date.now(), life: readRow('life'), year: readRow('year') });
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
      const info = (id) => {
        const row = document.getElementById(id);
        if (!row) return null;
        const reels = [...row.querySelectorAll('.reel')];
        const t0 = reels.length ? getComputedStyle(reels[0].querySelector('.reel-track')) : null;
        return {
          count: reels.length,
          cycles: reels.map(r => r.querySelectorAll('.reel-track > i').length / 2),
          hasDays: !!row.querySelector('.odo-num'),
          hidden: row.classList.contains('hidden'),
          dur: t0 ? t0.transitionDuration : '',
          ease: t0 ? t0.transitionTimingFunction : '',
          digitPx: reels.length ? getComputedStyle(reels[0]).fontSize : ''
        };
      };
      return {
        life: info('odoRow'), year: info('odoRowYear'),
        viewBtnVisible: !document.getElementById('viewToggle').classList.contains('hidden'),
        viewIcon: document.getElementById('viewIcon').textContent,
        yearHidden: document.getElementById('yearSection').classList.contains('hidden'),
        sectionVisible: !document.getElementById('countdownSection').classList.contains('hidden')
      };
    })()
  `);
  ok('默认在生命页（生命页显示、年份页藏着）', wiring.sectionVisible && wiring.yearHidden);
  ok('切页按钮已出现（初始化那一屏不该有它）', wiring.viewBtnVisible);
  ok('按钮图标指向「年份」（📅）', wiring.viewIcon === '📅', wiring.viewIcon);
  ok('生命行：6 根滚轮（时/分/秒 各两位）+ 静态天数',
    wiring.life.count === 6 && wiring.life.hasDays, `实得 ${wiring.life.count} 根`);
  ok('生命行圈长 = [3,10,6,10,6,10]（时十位 3 格、分/秒十位 6 格）',
    JSON.stringify(wiring.life.cycles) === JSON.stringify([3, 10, 6, 10, 6, 10]),
    JSON.stringify(wiring.life.cycles));
  ok('年份行：8 根滚轮（小时是 4 位！）+ 没有静态天数',
    wiring.year.count === 8 && !wiring.year.hasDays, `实得 ${wiring.year.count} 根`);
  ok('年份行圈长 = [9,10,10,10,6,10,6,10]（千位只用到 0-8）',
    JSON.stringify(wiring.year.cycles) === JSON.stringify([9, 10, 10, 10, 6, 10, 6, 10]),
    JSON.stringify(wiring.year.cycles));
  ok('滚动时长真的生效 600ms', wiring.life.dur === '0.6s', wiring.life.dur);
  ok('缓动曲线真的生效（平滑）', /0\.22,\s*0\.61,\s*0\.36,\s*1/.test(wiring.life.ease), wiring.life.ease);
  ok('数字字号 80px（窄窗口自适应钳制允许 ≤2% 收紧）',
    parseFloat(wiring.life.digitPx) >= 78 && parseFloat(wiring.life.digitPx) <= 80.001, wiring.life.digitPx);
  ok('年份行字号与生命行一致（同一条 clamp 曲线）',
    wiring.year.digitPx === wiring.life.digitPx, `${wiring.year.digitPx} vs ${wiring.life.digitPx}`);

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
      const wantLife = expectParts(s.t);
      const wantYear = expectYearParts(s.t);
      if (s.life) {
        if (String(wantLife.days) !== s.life.days) {
          bad.push(`${s.t}: 天 显示${s.life.days} 期望${wantLife.days}`);
        }
        for (const r of s.life.reels) {
          const exp = expectDigitOf(wantLife, r.key, r.idx, r.digits);
          if (r.shown !== exp) bad.push(`${s.t}: life.${r.key}${r.idx} 显示${r.shown} 期望${exp}`);
        }
      }
      if (s.year) {
        for (const r of s.year.reels) {
          const exp = expectDigitOf(wantYear, r.key, r.idx, r.digits);
          if (r.shown !== exp) bad.push(`${s.t}: year.${r.key}${r.idx} 显示${r.shown} 期望${exp}`);
        }
      }
      checked++;
    }
    console.log(`  采样 ${fixed.length} 帧，其中 ${checked} 帧落在「该翻牌之后」`);
    ok('接线正确：生命行 + 年份行的目标值 100% 等于真实读数', bad.length === 0,
      bad.slice(0, 3).join(' | ') || `核对了 ${checked} 帧 × 14 根滚轮`);
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
    const tag = (r) => r.row + '.' + r.key + r.idx;
    for (const s of live) {
      for (const name of ['life', 'year']) {
        if (!s[name]) continue;
        for (const r of s[name].reels) if (!stats[tag(r)]) stats[tag(r)] = { settled: 0, rolling: 0, bad: [] };
      }
    }
    let daysBad = [], checked = 0;

    for (const s of live) {
      const into = s.t % 1000;
      const nearBoundary = into < 35 || into > 965;
      const wantLife = expectParts(s.t);
      const wantYear = expectYearParts(s.t);
      const tasks = [];
      if (s.life) {
        if (String(wantLife.days) !== s.life.days) daysBad.push(`${s.t}: 显示${s.life.days} 期望${wantLife.days}`);
        tasks.push([s.life.reels, wantLife]);
      }
      if (s.year) tasks.push([s.year.reels, wantYear]);

      for (const [reels, want] of tasks) {
        for (const r of reels) {
          const st = stats[tag(r)];
          if (!r.settled) { st.rolling++; continue; }
          st.settled++;
          const exp = expectDigitOf(want, r.key, r.idx, r.digits);
          if (r.shown !== exp && !nearBoundary) st.bad.push(`${s.t}: 显示${r.shown} 期望${exp}`);
          if (!nearBoundary) checked++;
        }
      }
    }

    const allBad = Object.entries(stats).flatMap(([k, s]) => s.bad.map(b => k + ' ' + b));
    const pct = (k) => { const s = stats[k]; return 100 * s.rolling / (s.settled + s.rolling); };
    const rollPct = pct('year.seconds0');
    console.log(`  采样 ${live.length} 帧（${(live.length / 6).toFixed(0)} fps）` +
      `，年份行秒个位滚动占比 ${rollPct.toFixed(0)}%，累计核对 ${checked} 个停稳样本`);

    ok('动画态下停稳显示的数字 == 真实数字（0 次例外）', allBad.length === 0,
      allBad.slice(0, 3).join(' | '));
    ok('年份行秒个位确实在滚（动画没被冻住）', rollPct > 10, `${rollPct.toFixed(0)}%`);
    ok('生命行秒个位也在滚', pct('life.seconds0') > 10, `${pct('life.seconds0').toFixed(0)}%`);
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
      if (!s.life) continue;
      const sec = s.life.reels.find(r => r.key === 'seconds' && r.idx === 0).shown;
      if (prev !== null && sec !== prev) changes.push(s.t);
      prev = sec;
    }
    const phases = changes.map(t => Math.min(t % 1000, 1000 - (t % 1000)));
    ok('检出秒的翻牌（样本足够长）', changes.length >= 3, `${changes.length} 次`);
    ok('每次翻牌都贴着整秒边界（±120ms 内）', phases.every(p => p <= 120),
      `最大相位偏移 ${phases.length ? Math.max(...phases) : -1}ms`);
  }

  // ============================================================
  // [5] 切页按钮：生命页 ⇄ 年份页（赛博朋克 glitch 抖一下再翻页）
  console.log('\n[5] 右上角切页按钮（生命页 ⇄ 年份页）');
  {
    const snap = `(() => ({
      glitching: document.body.classList.contains('glitching'),
      lifeHidden: document.getElementById('countdownSection').classList.contains('hidden'),
      yearHidden: document.getElementById('yearSection').classList.contains('hidden'),
      icon: document.getElementById('viewIcon').textContent,
      hint: document.getElementById('viewToggle').title
    }))()`;

    await win.webContents.executeJavaScript(`document.getElementById('viewToggle').click(); true`);
    const mid = await win.webContents.executeJavaScript(snap);
    ok('点下去立刻开始抖（body.glitching 挂上）', mid.glitching);

    await new Promise(r => setTimeout(r, 400));
    const after = await win.webContents.executeJavaScript(snap);
    ok('抖完自动摘掉 glitching（不会一直闪）', !after.glitching);
    ok('已切到年份页：生命页收起、年份页露脸', after.lifeHidden && !after.yearHidden);
    ok('按钮图标与提示跟着换（⏳ / 切回生命）',
      after.icon === '⏳' && /生命/.test(after.hint), `${after.icon} | ${after.hint}`);

    // 切过去的瞬间年份行就该是对的 —— 它一直在被喂值，不是切过来才补算，
    // 所以不存在「从 12 时滚到 8700 时」那种电风扇。
    {
      const yr = await win.webContents.executeJavaScript(SAMPLER(1400, 30));
      let checked = 0, bad = [];
      for (const s of yr) {
        const into = s.t % 1000;
        if (into < 120 || into > 960) continue;
        if (!s.year) continue;
        const want = expectYearParts(s.t);
        for (const r of s.year.reels) {
          const exp = expectDigitOf(want, r.key, r.idx, r.digits);
          if (r.shown !== exp) bad.push(`${s.t}: year.${r.key}${r.idx} 显示${r.shown} 期望${exp}`);
        }
        checked++;
      }
      ok('年份页读数立刻正确（一直喂值，不需要补滚）',
        bad.length === 0 && checked > 0,
        bad.slice(0, 2).join(' | ') || `核对了 ${checked} 帧 × 8 根`);
    }

    // 今年进度条：切到年份页后应当有值
    const yp = await win.webContents.executeJavaScript(`
      (() => ({ pct: document.getElementById('yearPercent').textContent,
                w: document.getElementById('yearFill').style.width }))()
    `);
    ok('今年进度条有值、且与宽度一致（0 < pct < 100）',
      /%$/.test(yp.pct) && parseFloat(yp.pct) > 0 && parseFloat(yp.pct) < 100 && yp.w === yp.pct,
      `${yp.pct} / width=${yp.w}`);

    // 切回生命页
    await win.webContents.executeJavaScript(`document.getElementById('viewToggle').click(); true`);
    await new Promise(r => setTimeout(r, 400));
    const back = await win.webContents.executeJavaScript(snap);
    ok('切回生命页正常', !back.lifeHidden && back.yearHidden && back.icon === '📅');
  }

  win.hide();
  console.log(`\n合计 ${pass + fail} 条：${pass} PASS / ${fail} FAIL`);
  app.exit(fail ? 1 : 0);
}).catch(e => { console.error('FAILED:', e); app.exit(1); });
