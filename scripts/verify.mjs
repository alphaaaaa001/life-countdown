/**
 * 自带验收脚本 —— 从 script.js 里抽「真实现」跑对照，而不是读代码凭感觉。
 *
 *   node scripts/verify.mjs     （或 npm run verify）
 *
 * 覆盖四块：
 *   [A] 代码卫生：死代码残留、化石 id、getElementById 与 HTML 的交叉核对
 *   [B] 日期逻辑：固定 now 跑 parseLocalDate / calcAge / calcEndDate / odoSplitDuration
 *   [C] 心跳线：常量自洽、波形形态、t=0 整屏空白、真扫描测节律、漂移、留痕模型
 *   [D] 预览页 ↔ 正式版：心跳纯函数块是否逐字一致（防两份拷贝静默漂移）
 *
 * 所有期望值都从源码常量推导，不写死数字 —— 改参数后这个脚本仍然有效。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const jsSrc = read('script.js');
const htmlSrc = read('index.html');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  \x1b[32mPASS\x1b[0m ' + name + (extra ? '  \x1b[90m' + extra + '\x1b[0m' : '')); }
  else { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + name + (extra ? '  ' + extra : '')); }
};
const section = (t) => console.log('\n\x1b[1m' + t + '\x1b[0m');
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// ============================================================
// [A] 代码卫生
// ============================================================
section('[A] 代码卫生');

for (const f of ['parseBirthday', 'isLeapYear', 'getDaysInMonth', 'isValidDate',
                 'calculateTotalDays', 'calculateNextBirthday', 'getTimeDifference']) {
  const n = (jsSrc.match(new RegExp('\\b' + f + '\\b', 'g')) || []).length;
  ok(`不可达函数已清除：${f}`, n === 0, n ? `残留 ${n} 处` : '');
}
for (const id of ['daysToNext', 'hoursToNext', 'minutesToNext', 'secondsToNext']) {
  const n = (jsSrc + htmlSrc).split(id).length - 1;
  ok(`化石 id 已改名：${id}`, n === 0, n ? `残留 ${n} 处` : '');
}
// 读秒从「四个 span 直接写数字」改成了滚轮 —— 旧 id 不该再有人引用
for (const id of ['daysToEnd', 'hoursToEnd', 'minutesToEnd', 'secondsToEnd']) {
  const n = (jsSrc + htmlSrc).split(id).length - 1;
  ok(`读秒旧 span id 已移除：${id}`, n === 0, n ? `残留 ${n} 处` : '');
}
{
  const called = [...new Set([...jsSrc.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]))];
  const missing = called.filter(id => !htmlSrc.includes(`id="${id}"`));
  ok(`getElementById 的 ${called.length} 个 id 在 HTML 中都存在`, missing.length === 0,
    missing.length ? '缺失: ' + missing.join(', ') : '');
}
ok('渲染进程未使用 Node API（故无需 nodeIntegration）',
  !/\brequire\(|process\.|__dirname\b/.test(jsSrc), '');

// ============================================================
// [B] 日期逻辑（固定 now）
// ============================================================
section('[B] 日期逻辑（固定 now = 2026-09-14 12:00）');

const grabFn = (name) => jsSrc.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n}'))?.[0];
const dateCode = ['parseLocalDate', 'calcAge', 'calcEndDate', 'odoSplitDuration'].map(grabFn);
ok('日期工具函数可整块抽出', dateCode.every(Boolean));
const D = new Function(dateCode.join('\n') + '\nreturn { parseLocalDate, calcAge, calcEndDate, odoSplitDuration };')();
const NOW = new Date(2026, 8, 14, 12, 0, 0);   // 2026-09-14 12:00 本地

ok('生日已过 → 年龄不递减', D.calcAge(D.parseLocalDate('2004-03-15'), NOW) === 22);
ok('生日未到 → 年龄递减 1', D.calcAge(D.parseLocalDate('2005-10-23'), NOW) === 20);
ok('生日当天 → 算已满', D.calcAge(D.parseLocalDate('2004-09-14'), NOW) === 22);
{
  const b = D.parseLocalDate('2004-03-15');
  const end = D.calcEndDate(b, 80);
  ok('终点 = 出生年 + 寿命', end.getFullYear() === 2084);
  ok('出生日期解析为本地 00:00', b.getHours() === 0 && b.getMinutes() === 0);
  ok('终点落在本地 00:00（UTC 偏移已修）', end.getHours() === 0 && end.getMinutes() === 0,
    `${end.getFullYear()}-${end.getMonth() + 1}-${end.getDate()}`);
  const d = D.odoSplitDuration(end - NOW);
  const expectH = (24 - NOW.getHours()) % 24;
  ok('剩余时分秒无 8 小时残留', d.hours === expectH && d.minutes === 0,
    `${d.days}天 ${d.hours}时${d.minutes}分`);
}
ok('过期返回全 0', (() => { const z = D.odoSplitDuration(-1); return !z.days && !z.hours && !z.minutes && !z.seconds; })());

// ============================================================
// [C] 心跳线
// ============================================================
section('[C] 心跳线（笔尖描记式 ECG）');

const constSrc = jsSrc.match(/const ECG_BEAT_W[\s\S]*?const ECG_PULSE_MS.*?;/)[0];
const pureBlock = jsSrc.match(/\/\/ >>> ECG_PURE_MATH_BEGIN[\s\S]*?\/\/ <<< ECG_PURE_MATH_END/)[0];
const E = new Function(constSrc + '\n' + pureBlock + '\nreturn {' +
  ' ECG_BEAT_W, ECG_PERIOD_MS, ECG_PERIOD_S, ECG_SCROLL, ECG_AMPL, ECG_PEN_FRAC, ECG_FIRST_BEAT,' +
  ' ECG_POINTS, ecgPhaseValue, latestBeatAtOrBefore, ecgAmplAtScreenX, ecgAmplAtPen };')();

const W = 1920, PEN_X = Math.round(W * E.ECG_PEN_FRAC);
const P = E.ECG_PERIOD_S, S = E.ECG_SCROLL;
const beatsUpTo = (t) => { const b = []; for (let k = E.ECG_FIRST_BEAT; k <= t + 1e-9; k += P) b.push(k); return b; };

console.log(`  \x1b[90m参数：周期 ${E.ECG_PERIOD_MS}ms  心率 ${(60000 / E.ECG_PERIOD_MS).toFixed(1)}bpm  漂移 ${S.toFixed(1)}px/s  幅度 ${E.ECG_AMPL}px\x1b[0m`);
ok('一次心搏占宽 = 周期 × 漂移速度', close(E.ECG_BEAT_W, P * S, 1e-6));
ok('笔尖位于屏幕中央', PEN_X === W / 2, `x=${PEN_X}`);

// 波形形态
const peak = (lo, hi) => E.ECG_POINTS.filter(p => p[0] >= lo && p[0] < hi).reduce((a, b) => (b[1] > a[1] ? b : a));
const R = E.ECG_POINTS.find(p => p[1] === 1.0), Sdip = E.ECG_POINTS.reduce((a, b) => (b[1] < a[1] ? b : a));
const Pw = peak(0, 0.10), Tw = peak(0.25, 0.40), Uw = peak(0.40, 0.46);
ok('R 峰 = 1.000', close(E.ecgPhaseValue(R[0]), 1, 1e-9), `u=${R[0]}`);
ok('S 深谷为负向', E.ecgPhaseValue(Sdip[0]) < -0.3, `${E.ecgPhaseValue(Sdip[0]).toFixed(3)}`);
ok('P 波存在（正小丘）', Pw[1] > 0 && Pw[1] < 0.2, `${Pw[1]} @ u=${Pw[0]}`);
ok('T 波存在（正小丘）', Tw[1] > 0.2 && Tw[1] < 0.4, `${Tw[1]} @ u=${Tw[0]}`);
ok('U 波存在（正小丘）', Uw[1] > 0 && Uw[1] < 0.15, `${Uw[1]} @ u=${Uw[0]}`);
ok('相位序贯 P < QRS < T < U', Pw[0] < R[0] && R[0] < Tw[0] && Tw[0] < Uw[0]);
ok('全程无 NaN', (() => { for (let u = 0; u <= 1; u += 0.001) if (!Number.isFinite(E.ecgPhaseValue(u))) return false; return true; })());

// 核心诉求：一开始屏幕上什么都没有
{
  const nz = (t) => { let n = 0; for (let x = 0; x <= W; x++) if (E.ecgAmplAtScreenX(x, PEN_X, t, beatsUpTo(t)) !== 0) n++; return n; };
  ok('t=0 整屏振幅全为 0', nz(0) === 0);
  ok('首拍之前整屏仍为 0', nz(E.ECG_FIRST_BEAT * 0.9) === 0);
}

// 「咚」的那一下
{
  const tR = E.ECG_FIRST_BEAT + R[0] * P;
  ok('笔尖在 R 时刻 = 1.000', close(E.ecgAmplAtPen(tR, beatsUpTo(tR)), 1, 1e-6));
  ok('笔尖在 S 时刻下沉到谷底', close(E.ecgAmplAtPen(E.ECG_FIRST_BEAT + Sdip[0] * P, beatsUpTo(tR)), Sdip[1], 1e-6));
  ok('静息期回到基线 0', close(E.ecgAmplAtPen(E.ECG_FIRST_BEAT + 0.8 * P, beatsUpTo(tR)), 0, 1e-9));
}

// 真·扫描 10s 找 R 峰量节律（不预设答案）
{
  const peaks = [];
  let inPeak = false, best = -Infinity, bestT = 0;
  for (let t = 0; t <= 10; t += 0.001) {
    const v = E.ecgAmplAtPen(t, beatsUpTo(t));
    if (v >= 0.95) {
      if (!inPeak) { inPeak = true; best = -Infinity; }
      if (v > best) { best = v; bestT = t; }
    } else if (inPeak) { inPeak = false; peaks.push({ t: bestT, v: best }); }
  }
  ok('R 峰个数 = floor(10s / 周期)', peaks.length === Math.floor(10 / P), `检出 ${peaks.length} 个`);
  ok('每个 R 峰都触到 ~1.000', peaks.every(p => Math.abs(p.v - 1) < 0.05));
  const iv = peaks.slice(1).map((p, i) => p.t - peaks[i].t);
  ok('实测心搏间隔 = 心搏周期', iv.every(d => Math.abs(d - P) < 0.003),
    `${iv.map(d => d.toFixed(3)).join(', ')}s vs ${P}s`);
}

// 漂移方向与速度
{
  const peakX = (t) => {
    const b = beatsUpTo(t); let bx = -1, bv = -Infinity;
    for (let x = 0; x <= PEN_X; x++) { const v = E.ecgAmplAtScreenX(x, PEN_X, t, b); if (v > bv) { bv = v; bx = x; } }
    return bx;
  };
  const moved = peakX(6) - peakX(6.5);
  ok('墨迹朝左漂移', moved > 0, `Δx=${moved}px`);
  ok('漂移速度与参数一致', Math.abs(moved - 0.5 * S) <= 2 * S / 60 + 1, `期望 ≈${(0.5 * S).toFixed(1)}px`);
}

// 笔尖右侧恒为空白 + 描记前沿
{
  const b = beatsUpTo(8);
  let bad = 0;
  for (let x = PEN_X + 1; x <= W; x++) if (E.ecgAmplAtScreenX(x, PEN_X, 8, b) !== 0) bad++;
  ok('笔尖右侧恒为空白', bad === 0, `违例 ${bad}`);

  const minNonZero = (t) => {
    const bb = beatsUpTo(t);
    for (let x = 0; x <= PEN_X; x++) if (E.ecgAmplAtScreenX(x, PEN_X, t, bb) !== 0) return x;
    return Infinity;
  };
  const f1 = minNonZero(1), f3 = minNonZero(3), f6 = minNonZero(6);
  ok('波形从笔尖一拍拍长出来（前沿左移）', f1 >= f3 && f3 >= f6, `${f1} → ${f3} → ${f6}`);
  ok('1s 时波形还贴着笔尖', f1 > PEN_X * 0.8, `前沿 x=${f1}`);
  ok('未描到的区域恒为 0', (() => {
    for (const t of [6, 20]) {
      const bb = beatsUpTo(t), front = PEN_X - t * S;
      for (let x = 0; x < front - 1; x++) if (E.ecgAmplAtScreenX(x, PEN_X, t, bb) !== 0) return false;
    }
    return true;
  })());
}

// 留痕模型：后来发生的心搏不会改写已经描下的墨迹
{
  const past = [0.55, 2.15], future = [0.55, 2.15, 3.75], t = 3.0;
  let same = 0, total = 0;
  for (let x = 0; x <= PEN_X; x += 37) {
    total++;
    if (close(E.ecgAmplAtScreenX(x, PEN_X, t, future), E.ecgAmplAtScreenX(x, PEN_X, t, past), 1e-9)) same++;
  }
  ok('未来心搏不影响既有画面（墨迹是留痕的）', same === total, `${same}/${total}`);
}

// ============================================================
// [D] 预览页 ↔ 正式版：纯函数块逐字一致
// ============================================================
section('[D] 预览页 ↔ 正式版一致性');

// 取哨兵块「BEGIN 那一行之后」到「END 标记之前」的正文
const blockOf = (src, name) => {
  const b = src.indexOf('// >>> ' + name + '_BEGIN');
  const e = src.indexOf('// <<< ' + name + '_END');
  if (b < 0 || e < 0 || e < b) return null;
  return src.slice(src.indexOf('\n', b) + 1, e);
};

const HB_PREVIEW = read('heartbeat-preview.html');
const hbSrcBlk = blockOf(jsSrc, 'ECG_PURE_MATH');
const hbPrevBlk = blockOf(HB_PREVIEW, 'ECG_PURE_MATH');
ok('心跳哨兵块两边都在：正式版 script.js + heartbeat-preview.html', !!hbSrcBlk && !!hbPrevBlk,
  hbSrcBlk && hbPrevBlk ? `${hbSrcBlk.split('\n').length} 行` : '缺一侧');
ok('心跳纯函数块：正式版 ↔ 心跳预览页 逐字一致',
  !!hbSrcBlk && hbSrcBlk === hbPrevBlk,
  hbSrcBlk === hbPrevBlk ? '' : '两边已漂移，预览页的读数不再可信！');
ok('心跳预览页不再自己手写一份 ECG_POINTS（必须来自同一块）',
  (HB_PREVIEW.match(/const ECG_POINTS\s*=\s*\[/g) || []).length === 1,
  `出现 ${(HB_PREVIEW.match(/const ECG_POINTS\s*=\s*\[/g) || []).length} 次`);

// ============================================================
// [E] 「年份倒计时」页 + 右上角切页按钮
// ============================================================
section('[E] 年份倒计时页（⇄ 切页）');

{
  // 读数行注册表里的 el 是【字符串】，不在 getElementById 里 —— 上面那条交叉核对盖不到，单独查
  const cfgIds = [...jsSrc.matchAll(/el:\s*'([^']+)'/g)].map((m) => m[1]);
  const missCfg = cfgIds.filter((id) => !htmlSrc.includes(`id="${id}"`));
  ok(`读数行注册表里 ${cfgIds.length} 个 id 在 HTML 中都存在`, missCfg.length === 0,
    missCfg.length ? '缺失: ' + missCfg.join(', ') : cfgIds.join(' / '));

  for (const id of ['yearSection', 'viewToggle', 'viewIcon', 'yearPercent', 'yearFill', 'odoRowYear']) {
    ok(`年份页元素存在：${id}`, htmlSrc.includes(`id="${id}"`));
  }
  ok('切页按钮挂在 toggleYearView() 上',
    /onclick="toggleYearView\(\)"/.test(htmlSrc) && /function toggleYearView\(\)/.test(jsSrc));

  // 年份页 = 大卡 + 今年进度 + 重新设置（生命页那两张"年数"小卡不在里面）
  const yi = htmlSrc.indexOf('id="yearSection"');
  const yearSec = yi >= 0 ? htmlSrc.slice(yi, yi + 1500) : '';
  ok('年份页里有「今年进度」，且不含「已度过 / 剩余」那两张年数小卡',
    /今年进度/.test(yearSec) && !/id="passedYears"/.test(yearSec) &&
    !/id="remainingYears"/.test(yearSec));
  ok('年份页沿用同一套卡片样式（stat-card large + odo-row）',
    /class="stat-card large"/.test(yearSec) && /id="odoRowYear"/.test(yearSec));

  // 年份行：小时 4 位、圈长表登记了 yearHours、终点是次年 1/1 本地时间
  ok('年份行小时 4 位，且圈长表登记了 yearHours = 8784',
    /cycleKey: 'yearHours',\s+digits: 4/.test(jsSrc) && /yearHours:\s*8784/.test(jsSrc));
  ok('年份终点 = 次年 1/1（本地时区）',
    /new Date\(now\.getFullYear\(\) \+ 1, 0, 1\)/.test(jsSrc));
  ok('今年进度 = (now − 1/1) / (次年1/1 − 1/1)，并写进进度条',
    /\(now - jan1\) \/ \(nextJan1 - jan1\)/.test(jsSrc) &&
    /getElementById\('yearFill'\)\.style\.width/.test(jsSrc));

  // 圈长不再写死：旧的三行 if 必须消失，改由取值范围表推导
  ok('圈长不再写死（旧的 `if (group === \'hours\') return 3;` 已消失）',
    !/if \(group === 'hours'\) return 3;/.test(jsSrc) &&
    /const ODO_FIELD_MAX = \{/.test(jsSrc) && /function odoMaxDigitAt/.test(jsSrc));

  // 「防电风扇」的盲区：跨年/改设置时【数值突变但时间没跳】，时间差判据看不见
  ok('跨年显式落位（不指望时间差判据）',
    /year !== odoYearStamp\) odoSnapRow\('year'\)/.test(jsSrc));
  ok('重新设置时清干净所有行 + 回到生命页 + 收起切页按钮',
    /odoSnapAll\(\)/.test(jsSrc) && /viewMode = 'life'/.test(jsSrc) &&
    /getElementById\('viewToggle'\)\.classList\.add\('hidden'\)/.test(jsSrc));

  const css = read('style.css');
  ok('CSS：glitch 两段动画（整体错位 + 数字色分离），挂在 body 上',
    /@keyframes odoJitter/.test(css) && /@keyframes odoRgbSplit/.test(css) &&
    /body\.glitching \.odo-row/.test(css) && /body\.glitching \.reel-track > i/.test(css));
  ok('CSS：尊重 prefers-reduced-motion（不抖，直接换页）',
    /@media \(prefers-reduced-motion: reduce\)/.test(css) && /animation: none/.test(css));
  ok('CSS：动画没碰 .reel-track 自己的 transform（否则会与滚动过渡打架）',
    !/glitching \.reel-track\s*\{/.test(css));
  ok('CSS：切页按钮钉在主题按钮正下方（top:80 / right:20）',
    /\.view-toggle\s*\{[^}]*top:\s*80px[^}]*right:\s*20px/.test(css));
  ok('布局：容器竖向 flex + 至少一屏高；#yearSection margin-top:auto ⇒ 落在心跳基线之下',
    /flex-direction: column/.test(css) && /min-height: 100vh/.test(css) &&
    /#yearSection\s*\{[^}]*margin-top: auto/.test(css));
  // 旧的「卡片内切换」那一套必须清干净 —— 上一版就在这里留过一堆死代码
  ok('旧的卡片内切换已清除（oySection / oySwitch / oyTitle / odoRowLife2 一个不留）',
    !/oySection|oySwitch|oyTitle|odoRowLife2/.test(jsSrc + htmlSrc + css));
}

// ============================================================
// [F] 读数「无壳」—— 与背景心跳线融为一体
// ============================================================
section('[F] 读数无壳（与心跳线融为一体）');

{
  // ⚠️ 先剥掉 CSS 注释再断言 —— 注释里常常写着「示例代码」（本项目就有
  //    「.warning-section { border-left: … }」「把 .stat-card:hover 加回来」这类说明），
  //    不剥的话正则会被注释骗到，报出根本不存在的"违规"。实测踩过。
  const css = read('style.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const blockOf = (sel) => {
    const pat = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}';
    const m = css.match(new RegExp(pat));
    return m ? m[1] : '';
  };
  const card = blockOf('.stat-card');
  const large = blockOf('.stat-card.large');
  const prog = blockOf('.progress-section');
  const warn = blockOf('.warning-section');

  ok('.stat-card：无背景 / 无边框 / 无阴影（数字直接坐在背景上）',
    /background:\s*transparent/.test(card) && /border:\s*none/.test(card) &&
    /box-shadow:\s*none/.test(card),
    card.trim().replace(/\s+/g, ' ').slice(0, 64));
  ok('大卡不再有「聚光背景」', /background:\s*none/.test(large));
  ok('卡片 hover 抬升已删除（不再有 .stat-card:hover 规则）',
    !/\.stat-card:hover\s*\{/.test(css));
  ok('进度区段也去壳（进度条自己带底色，不需要外面再套一层）',
    /background:\s*transparent/.test(prog) && /border:\s*none/.test(prog));
  ok('健康提示也去壳（靠标题的警示色说话）',
    /background:\s*transparent/.test(warn) && /border:\s*none/.test(warn));

  // 反面也要守住：别把该留的也扒了
  ok('初始化表单仍保留面板（表单需要「能填」的样子）',
    /\.panel\s*\{[^}]*border:\s*2px solid var\(--panel-border\)/.test(css));
  ok('两个圆形按钮仍保留底面（剥掉就看不见按钮了）',
    /\.theme-toggle\s*\{[^}]*background:\s*var\(--panel-bg\)/.test(css) &&
    /\.view-toggle\s*\{[^}]*background:\s*var\(--panel-bg\)/.test(css));
}

console.log(`\n\x1b[1m===== ${pass} 通过 / ${fail} 失败 =====\x1b[0m\n`);
process.exit(fail ? 1 : 0);
