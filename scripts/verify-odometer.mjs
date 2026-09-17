/**
 * 滚轮读秒对照测试：从 script.js（正式版，唯一实现）里把纯函数区整块抽出来跑，
 * 模拟真实倒计时逐秒喂进去，验证「滚轮显示的数字」永远等于「真实数字」，
 * 且每一次步进都恰好 1 格（含十位回绕，不许出现糊成一片的多格猛扫）。
 *   node scripts/verify-odometer.mjs
 *
 * 末段还会核对 odometer-preview.html 里的同名纯函数块是否与正式版【逐字】一致 ——
 * 两份拷贝一旦漂移，调参沙盒给出的参数就不可信了。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_FILE = path.join(ROOT, 'script.js');
const PREVIEW_FILE = path.join(ROOT, 'odometer-preview.html');
const BLOCK_RE = /\/\/ >>> ODO_PURE_MATH_BEGIN[^\n]*\n([\s\S]*?)\/\/ <<< ODO_PURE_MATH_END/;

const src = fs.readFileSync(SRC_FILE, 'utf8');
const block = src.match(BLOCK_RE);
if (!block) { console.error('未找到 ODO_PURE_MATH 哨兵块'); process.exit(1); }

// 真本体：整块抽出来 eval，不重写
const M = new Function(block[1] + `
  return { odoSplitDuration, odoDigitsOf, odoCycleFor, odoCellDigit,
           odoOffsetForDigit, odoReelDelta, odoAdvance, odoEffectiveDur, ODO_FRAME_MS,
           odoIsBigJump, ODO_JUMP_MS,
           odoSplitYearSpan, odoYearEnd, odoMaxDigitAt, ODO_FIELD_MAX };
`)();

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? '  ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  ' + detail : ''}`); }
};

const REEL_CYCLES = 2;
const PLACES = [
  ['hours', 1], ['hours', 0], ['minutes', 1], ['minutes', 0], ['seconds', 1], ['seconds', 0]
];

// 复刻预览页 feedReel 的状态机（去掉 DOM）
function feed(st, digit, animate = true) {
  if (!st.ready) {
    st.digit = digit;
    st.offset = M.odoOffsetForDigit(digit, st.cycle);
    st.ready = true;
    st.max = Math.max(st.max, st.offset);
    return;
  }
  if (!animate) {
    if (digit === st.digit) return;
    st.digit = digit; st.offset = M.odoOffsetForDigit(digit, st.cycle); return;
  }
  const step = M.odoAdvance(st.offset, st.digit, digit, st.cycle);
  if (step.delta === 0) return;
  st.digit = digit;
  // 注意：本复刻「每拍都喂」，间隔恒等于节拍 → 永远走不到「大跳落位」（那条按时间差判），
  // 所以这里不建模时间；时间差判定由 [7] 单独验。
  if (step.folded) st.offset = st.offset % st.cycle;
  st.offset = step.offset;
  st.max = Math.max(st.max, st.offset);
  st.steps++;
  st.deltas.push(step.delta);
  st.folds += step.folded ? 1 : 0;
}
const newReel = (cycle) => ({ cycle, ready: false, digit: 0, offset: 0, deltas: [], steps: 0, folds: 0, max: 0 });

console.log(`源文件: ${path.relative(ROOT, SRC_FILE)}`);
console.log(`抽取的纯函数区: ${block[1].split('\n').length} 行\n`);

// ---------------------------------------------------------------
console.log('[1] 每位数字的「圈长」——十位不是十格轮');
{
  ok('个位 → 10 格', M.odoCycleFor('seconds', 0) === 10 && M.odoCycleFor('minutes', 0) === 10);
  ok('分/秒十位 → 6 格（0-5）', M.odoCycleFor('seconds', 1) === 6 && M.odoCycleFor('minutes', 1) === 6);
  ok('小时十位 → 3 格（0-2）', M.odoCycleFor('hours', 1) === 3);
}

// ---------------------------------------------------------------
console.log('\n[2] 每根滚带的格子排列（递减序 + 按圈长回绕）');
{
  const seq = (c, n = 2 * c) => [...Array(n).keys()].map(i => M.odoCellDigit(i, c));
  ok('圈长 10 → 0,9,8,7,6,5,4,3,2,1,0,9,…', seq(10, 12).join(',') === '0,9,8,7,6,5,4,3,2,1,0,9');
  ok('圈长 6  → 0,5,4,3,2,1,0,5,4,3,2,1', seq(6, 12).join(',') === '0,5,4,3,2,1,0,5,4,3,2,1');
  ok('圈长 3  → 0,2,1,0,2,1', seq(3, 6).join(',') === '0,2,1,0,2,1');

  const inv = [10, 6, 3].every(c =>
    [...Array(c).keys()].every(d => M.odoCellDigit(M.odoOffsetForDigit(d, c), c) === d));
  ok('反查：任意数字都能找到唯一落点', inv);
}

// ---------------------------------------------------------------
console.log('\n[3] 步进方向：按圈长算，递减永远是 1 格 —— 含十位回绕');
{
  const d10 = [...Array(10).keys()].map(d => M.odoReelDelta(d, (d - 1 + 10) % 10, 10));
  ok('个位 9→8→…→0 全 1 格', d10.every(x => x === 1), d10.join(','));

  // 十位：5→4→…→0→5→4…  最后那条 0→5 就是以前的病根
  const d6 = [5, 4, 3, 2, 1, 0].map(d => M.odoReelDelta(d, (d - 1 + 6) % 6, 6));
  ok('秒十位 5→4→…→0→5 全 1 格（旧版这里是 5 格猛扫）', d6.every(x => x === 1), d6.join(','));

  const d3 = [2, 1, 0].map(d => M.odoReelDelta(d, (d - 1 + 3) % 3, 3));
  ok('时十位 2→1→0→2 全 1 格', d3.every(x => x === 1), d3.join(','));

  ok('数字没变 → delta = 0', M.odoReelDelta(7, 7, 10) === 0);
}

// ---------------------------------------------------------------
console.log('\n[4] 折回不改变画面');
{
  const bad = [];
  for (const c of [10, 6, 3]) {
    for (let o = 0; o < 4 * c; o++) {
      if (M.odoCellDigit(o % c, c) !== M.odoCellDigit(o, c)) bad.push(`c=${c},o=${o}`);
    }
  }
  ok('偏移折回整数圈前后显示一致', bad.length === 0, bad.join(' '));
}

// ---------------------------------------------------------------
console.log('\n[5] 单轮 1000 步：方向恒定、永不滚出轨道');
{
  const st = newReel(6);
  let cur = 5;
  feed(st, cur);                 // 首次落位不算步进（否则会误判 undefined）
  let allOne = true, track = true;
  for (let k = 0; k < 1000; k++) {
    cur = (cur - 1 + 6) % 6;
    feed(st, cur);
    if (st.deltas[st.deltas.length - 1] !== 1) allOne = false;
    if (M.odoCellDigit(st.offset, st.cycle) !== cur) track = false;
    if (st.offset >= 6 * REEL_CYCLES) track = false;
  }
  ok('1000 步全程恰好 1 格', allOne);
  ok('1000 步显示全对且偏移不越界', track, `峰值偏移 ${st.max} < ${6 * REEL_CYCLES}`);
  ok('折回确实发生过（不是靠不折回硬撑）', st.folds > 150, `折回 ${st.folds} 次`);
}

// ---------------------------------------------------------------
console.log('\n[6] 整行仿真：从 1 天 02:03:04 倒着走到底，6 个滚轮全程零错');
{
  const st = {};
  for (const [g, i] of PLACES) st[g + i] = newReel(M.odoCycleFor(g, i));

  let total = 1 * 86400 + 2 * 3600 + 3 * 60 + 4;
  let errors = 0, firstError = null;

  for (; total >= 0; total--) {
    const p = M.odoSplitDuration(total * 1000);
    const want = {
      hours: M.odoDigitsOf(p.hours, 2),
      minutes: M.odoDigitsOf(p.minutes, 2),
      seconds: M.odoDigitsOf(p.seconds, 2)
    };
    for (const [g, idx] of PLACES) {
      const digit = want[g][1 - idx];
      const r = st[g + idx];
      feed(r, digit);
      if (M.odoCellDigit(r.offset, r.cycle) !== digit) {
        errors++;
        if (!firstError) firstError = `${g}${idx} @ 剩${p.days}天${p.hours}:${p.minutes}:${p.seconds} 期望${digit} 实得${M.odoCellDigit(r.offset, r.cycle)}`;
      }
    }
  }

  ok('93,784 秒全程、6 个滚轮零错位', errors === 0, firstError || '');

  const totalSteps = Object.values(st).reduce((a, r) => a + r.steps, 0);
  const nonOne = k => st[k].deltas.filter(d => d !== 1).length;

  // 核心回归：秒/分的十位每分钟都会回绕（0↔5），这一条修好了才叫真修好
  ok('秒十位 / 分十位永不猛扫（每分钟发生的那次回绕）',
    nonOne('seconds1') === 0 && nonOne('minutes1') === 0,
    `秒十位 ${st.seconds1.steps} 步、分十位 ${st.minutes1.steps} 步，非 1 格 0 次`);

  // 个位（0-9 十格轮）本身没有问题
  ok('各「个位」滚轮永不猛扫',
    ['seconds0', 'minutes0'].every(k => nonOne(k) === 0),
    `秒个位 ${st.seconds0.steps} 步、分个位 ${st.minutes0.steps} 步`);

  // 唯一残留：天进位时小时 00→23，个位要走 7 格 —— 每天 1 次，机械counter 也是这么走的
  const dayCarry = nonOne('hours0');
  const allOthers = Object.keys(st)
    .filter(k => k !== 'hours0')
    .reduce((a, k) => a + nonOne(k), 0);
  ok('非 1 格只允许出现在「天进位」那一刻（其余全为 0）',
    allOthers === 0 && dayCarry <= 1,
    `天进位 ${dayCarry} 次 / 其余 ${allOthers} 次（共 ${totalSteps} 次步进）`);
  ok('天进位那一次的 delta = (0-3+10)%10 = 7',
    dayCarry === 0 || st.hours0.deltas.filter(d => d !== 1)[0] === 7,
    `delta = ${st.hours0.deltas.filter(d => d !== 1)[0]}`);

  const peak = Math.max(...Object.values(st).map(r => r.max));
  ok('峰值偏移 < 滚带格数（不会露出空白格）',
    Object.values(st).every(r => r.max < r.cycle * REEL_CYCLES), `峰值 ${peak}`);

  const s0 = st.seconds0.steps, s1 = st.seconds1.steps;
  ok('秒个位 ≈ 秒十位的 10 倍', Math.abs(s0 / s1 - 10) < 0.2, `${s0} vs ${s1}`);
}

// ---------------------------------------------------------------
console.log('\n[7] 「大跳落位」由时间差判定（休眠唤醒 / 改了设置）');
{
  // 旧判定写成 `delta >= cycle`，但 odoReelDelta 末尾有 `% cycle`，
  // 返回值天生被封在 [0, cycle-1] —— 那条分支从来没执行过。先用穷举钉死这一点。
  const maxDelta = (c) => Math.max(...[...Array(c).keys()]
    .flatMap(p => [...Array(c).keys()].map(n => M.odoReelDelta(p, n, c))));
  ok('旧门槛数学上不可达：delta 的峰值只有 cycle − 1',
    [3, 6, 10].every(c => maxDelta(c) === c - 1),
    [3, 6, 10].map(c => `cycle=${c}→max ${maxDelta(c)}`).join('  '));

  // 新判定：看「距上次喂值过了多久」
  ok('正常节拍（1000ms 的 1 倍）不算大跳', M.odoIsBigJump(1000) === false);
  ok('机器卡顿到 2999ms 仍不算大跳', M.odoIsBigJump(2999) === false);
  ok('越过门槛（3001ms）判为大跳 → 直接落位', M.odoIsBigJump(3001) === true);
  ok('休眠一小时后回来 → 大跳', M.odoIsBigJump(3600 * 1000) === true);
  ok('间隔拿不到（NaN / undefined）→ 按大跳处理，首帧不滚',
    M.odoIsBigJump(NaN) === true && M.odoIsBigJump(undefined) === true);
  ok('门槛本身：3000ms 不触发、3001ms 触发（边界是「大于」而非「大于等于」）',
    M.odoIsBigJump(M.ODO_JUMP_MS) === false && M.odoIsBigJump(M.ODO_JUMP_MS + 1) === true,
    `ODO_JUMP_MS = ${M.ODO_JUMP_MS}`);

  const st = newReel(10);
  feed(st, 9);                 // 起始 9
  const posBefore = st.offset;
  feed(st, 2);                 // 一次跳 7 格
  ok('纯数学上跳 7 格仍在合法范围（时间差判定不在纯函数层，故照滚）',
    st.offset === posBefore + 7, `offset ${posBefore} → ${st.offset}`);

  const st2 = newReel(10);
  feed(st2, 9);
  ok('数字不变时不产生步进', M.odoAdvance(st2.offset, 9, 9, 10).delta === 0);
}

// ---------------------------------------------------------------
console.log('\n[8] 时钟读数边界');
{
  const cases = [
    [0, [0, 0, 0, 0]],
    [999, [0, 0, 0, 0]],
    [1000, [0, 0, 0, 1]],
    [86400000, [1, 0, 0, 0]],
    [86400000 + 3599999, [1, 0, 59, 59]],
  ];
  let allOk = true, detail = [];
  for (const [ms, want] of cases) {
    const g = M.odoSplitDuration(ms);
    const got = [g.days, g.hours, g.minutes, g.seconds];
    if (got.join() !== want.join()) { allOk = false; detail += `${ms}:${got} `; }
  }
  ok('毫秒差 → 天/时/分/秒 边界正确', allOk, detail);

  ok('负数（已过期）归零不崩',
    (() => { const g = M.odoSplitDuration(-5000); return g.days + g.hours + g.minutes + g.seconds === 0; })());
  ok('定长补零：7 → "07"、20649 → "49"',
    M.odoDigitsOf(7, 2).join('') === '07' && M.odoDigitsOf(20649, 2).join('') === '49');
}

// ---------------------------------------------------------------
console.log('\n[9] 倍速下的「有效滚动时长」：动画绝不跨过下一次更新');
{
  // 背景：读数节拍 dt = 1000/speed。滚动动画必须在下一次更新前跑完，
  // 并留出至少一帧让数字落格；否则滚轮停在两格之间，屏幕上是错的数字。
  // Electron 真渲染实测：dur > dt 正确率恒 0%；只留 10% 停稳期在 15× 下也是 0%。
  const FRAME = M.ODO_FRAME_MS;
  const dtOf = s => 1000 / s;
  const speeds = [1, 2, 5, 8, 15, 30];
  const wants = [0, 50, 150, 180, 300, 600];

  let bad = null;
  for (const s of speeds) {
    for (const w of wants) {
      const e = M.odoEffectiveDur(w, s);
      if (!(e >= 0)) { bad = `${s}×/${w}ms 出现负值 ${e}`; break; }
      if (e > w + 1e-9) { bad = `${s}× 把 ${w}ms 放大成了 ${e}ms`; break; }
      if (e > dtOf(s) - FRAME + 1e-9) { bad = `${s}×/${w}ms → ${e} 未给一帧留白`; break; }
    }
    if (bad) break;
  }
  ok('全部 36 组：有效时长 ≤ 节拍 − 一帧，且绝不放大', !bad, bad || '');

  ok('未触顶时不干扰设定值（150ms 在 1×/2×/5× 下原样保留）',
    [1, 2, 5].every(s => Math.abs(M.odoEffectiveDur(150, s) - 150) < 1e-9),
    [1, 2, 5].map(s => `${s}×:${M.odoEffectiveDur(150, s)}`).join(' '));

  ok('15× 下无论设多大都钳到 50ms（66.67 − 16.67）',
    Math.abs(M.odoEffectiveDur(180, 15) - 50) < 1e-6 && Math.abs(M.odoEffectiveDur(600, 15) - 50) < 1e-6,
    `180→${M.odoEffectiveDur(180, 15).toFixed(1)}  600→${M.odoEffectiveDur(600, 15).toFixed(1)}`);

  ok('5× 下钳到 183.3ms（200 − 16.67）',
    Math.abs(M.odoEffectiveDur(600, 5) - (200 - FRAME)) < 1e-6,
    `600→${M.odoEffectiveDur(600, 5).toFixed(1)}ms`);

  ok('钳制后必留 ≥ 一帧停稳期（含极端倍速）',
    speeds.every(s => wants.every(w => dtOf(s) - M.odoEffectiveDur(w, s) >= Math.min(FRAME, dtOf(s)) - 1e-9)));

  // 正式版是 setInterval(…, 1000)，节拍恒 1×、滑块上限 600ms —— 永不触顶
  ok('正式版安全：1× 下 0-600ms 全部原样生效（节拍 1000ms，留白 983ms）',
    M.odoEffectiveDur(600, 1) === 600 && M.odoEffectiveDur(0, 1) === 0);

  ok('0ms（硬切）恒为 0，不被钳出负数', speeds.every(s => M.odoEffectiveDur(0, s) === 0));
}

// ---------------------------------------------------------------
console.log('\n[10] 一致性自检');
{
  // 正式版是唯一实现，odometer-preview.html 是调参沙盒 ——
  // 两边的纯函数块必须逐字相同，否则沙盒里调出来的参数不可信
  const pb = fs.readFileSync(PREVIEW_FILE, 'utf8').match(BLOCK_RE);
  ok('预览页里也有同一块纯函数', !!pb);
  ok('正式版 ↔ 预览页 纯函数块逐字一致', !!pb && pb[1] === block[1]);

  // 定稿参数（时+分+秒 / 600ms / 平滑 / 80px）是否真的烙进了正式版
  ok('定稿：数字字号 80px', /const ODO_DIGIT_PX\s*=\s*80;/.test(src));
  ok('定稿：滚动时长 600ms', /const ODO_ROLL_MS\s*=\s*600;/.test(src));
  ok('定稿：缓动 = 平滑 cubic-bezier(0.22, 0.61, 0.36, 1)',
    /const ODO_EASE\s*=\s*'cubic-bezier\(0\.22, 0\.61, 0\.36, 1\)';/.test(src));
  ok('滚带圈数与仿真一致（ODO_REEL_CYCLES = 2）', /const ODO_REEL_CYCLES = 2;/.test(src));

  // 驱动方式：必须挂在真实读数上，而不是"页面加载即启动的固定时长动画"
  // （2026-09-17 改成多行注册表后，喂值入口从 odoFeedParts 换成 odoFeedRow）
  ok('每拍都由 updateCountdown 喂真实读数（生命行 + 年份行）',
    /odoFeedRow\('life', lifeParts\)/.test(src) &&
    /odoFeedRow\('life2', lifeParts\)/.test(src) &&
    /odoFeedRow\('year', odoSplitYearSpan\(odoYearEnd\(now\) - now\)\)/.test(src));
  ok('时/分/秒 都参与滚动：每行按 digits 逐位建滚轮（生命行 2+2+2 = 6 根）',
    /key: 'hours',\s+cycleKey: 'hours',\s+digits: 2/.test(src) &&
    /key: 'minutes',\s+cycleKey: 'minutes',\s+digits: 2/.test(src) &&
    /key: 'seconds',\s+cycleKey: 'seconds',\s+digits: 2/.test(src) &&
    /for \(let idx = f\.digits - 1; idx >= 0; idx--\)/.test(src));

  // 正式版节拍 1000ms、滚动 600ms → 永不触顶（CSS 里的 600ms 只是 JS 启动前的兜底）
  ok('正式版节拍永不触顶：600ms 远小于 1000ms − 一帧',
    M.odoEffectiveDur(600, 1) === 600 && 1000 - M.ODO_FRAME_MS - 600 > 380,
    `留白 ${(1000 - M.ODO_FRAME_MS - 600).toFixed(0)}ms`);

  // 定稿值在 CSS 兜底里也对得上（JS 会用同一份常量覆盖）
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  ok('CSS 兜底与 JS 常量一致：字号 80px', /--digit-want:\s*80px/.test(css));
  ok('CSS 兜底与 JS 常量一致：时长 600ms', /--reel-dur:\s*600ms/.test(css));
  ok('CSS 兜底与 JS 常量一致：平滑曲线',
    /--reel-ease:\s*cubic-bezier\(0\.22, 0\.61, 0\.36, 1\)/.test(css));
  ok('窄窗口有字号收紧（min(…, vw)），不会把整行挤换行',
    /--digit-size:\s*min\(var\(--digit-want\)/.test(css));
}

console.log('\n[11] 年份倒计时行：小时是【总小时数】(0..8784)，不是 0-23');
{
  // 终点 = 次年 1/1 00:00（本地时区）。用固定日期构造，结论与时区无关。
  const end = M.odoYearEnd(new Date(2026, 5, 15, 12, 0, 0));
  ok('终点 = 次年 1/1 00:00 本地时间',
    end.getFullYear() === 2027 && end.getMonth() === 0 && end.getDate() === 1 &&
    end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0);

  const leapStart = new Date(2028, 0, 1, 0, 0, 1);          // 2028 是闰年
  const lp = M.odoSplitYearSpan(M.odoYearEnd(leapStart) - leapStart);
  ok('闰年开局 = 8783 时 59 分 59 秒（四位数的上界）',
    lp.hours === 8783 && lp.minutes === 59 && lp.seconds === 59,
    `${lp.hours} 时 ${lp.minutes} 分 ${lp.seconds} 秒`);

  // 圈长：小时 4 位 ⇒ 千位只有 0-8（9 格），其余各位 0-9（10 格）
  const yc = [3, 2, 1, 0].map(i => M.odoCycleFor('yearHours', i));
  ok('年份行小时四位的圈长 = [千9 · 百10 · 十10 · 个10]',
    JSON.stringify(yc) === '[9,10,10,10]', yc.join('/'));

  // 泛化后的圈长必须复现「原来写死的三个值」——这是本次重构的安全绳
  ok('泛化圈长复现旧值：个位10 · 时十位3 · 分十位6 · 秒十位6',
    M.odoCycleFor('hours', 0) === 10 && M.odoCycleFor('hours', 1) === 3 &&
    M.odoCycleFor('minutes', 0) === 10 && M.odoCycleFor('minutes', 1) === 6 &&
    M.odoCycleFor('seconds', 1) === 6);

  // 真走一段：从「1001:00:00」倒着走到 1001 小时之前，稳跨 千位 1→0
  const target = new Date(2028, 0, 1, 0, 0, 0);
  const start = new Date(target.getTime() - 1001 * 3600000);
  const sim = [
    { idxs: [3, 2, 1, 0], reels: [3, 2, 1, 0].map(i => newReel(M.odoCycleFor('yearHours', i))), key: 'hours' },
    { idxs: [1, 0], reels: [1, 0].map(i => newReel(M.odoCycleFor('minutes', i))), key: 'minutes' },
    { idxs: [1, 0], reels: [1, 0].map(i => newReel(M.odoCycleFor('seconds', i))), key: 'seconds' }
  ];
  const shown = (st) => M.odoCellDigit(st.offset, st.cycle);   // 从停格反推显示的数字
  let mismatch = 0, maxDelta = 0;
  const STEPS = 3 * 3600 + 5;
  for (let s = 0; s <= STEPS; s++) {
    const now = new Date(start.getTime() + s * 1000);
    const p = M.odoSplitYearSpan(target - now);
    const digs = { hours: M.odoDigitsOf(p.hours, 4),
                   minutes: M.odoDigitsOf(p.minutes, 2),
                   seconds: M.odoDigitsOf(p.seconds, 2) };
    for (const g of sim) {
      const d = digs[g.key], n = d.length;
      g.idxs.forEach((idx, k) => feed(g.reels[k], d[n - 1 - idx], true));
      g.idxs.forEach((idx, k) => { if (shown(g.reels[k]) !== d[n - 1 - idx]) mismatch++; });
      for (const st of g.reels) maxDelta = Math.max(maxDelta, ...st.deltas.slice(-1));
    }
  }
  ok(`年份行 ${STEPS + 1} 拍 × 8 根滚轮：显示的数字全程等于真实值`, mismatch === 0,
    `不一致 ${mismatch} 次`);
  ok('年份行每次步进恰好 1 格（含千位 1→0、十位回绕）', maxDelta === 1,
    `最大步进 ${maxDelta} 格`);
  ok('秒个位每拍都在动（不是冻住的）',
    sim[2].reels[1].steps >= STEPS - 2, `${sim[2].reels[1].steps} 次`);

  // 跨年那一刻数值是突变的：时间差判据（odoIsBigJump）根本看不见它，
  // 所以正式版必须显式落位 —— 这条用源码级断言钉住，别退回去只靠时间差。
  const t0 = new Date(2027, 11, 31, 23, 59, 59);
  const t1 = new Date(2028, 0, 1, 0, 0, 1);
  const b = M.odoSplitYearSpan(M.odoYearEnd(t0) - t0);
  const a = M.odoSplitYearSpan(M.odoYearEnd(t1) - t1);
  ok('跨年那一刻数值确实突变（0 时 → 8783 时）', b.hours === 0 && a.hours === 8783,
    `${b.hours} 时 → ${a.hours} 时`);
  ok('正式版在跨年/改设置时【显式落位】，不指望时间差判据',
    /year !== odoYearStamp\) odoSnapRow\('year'\)/.test(src) &&
    /odoSnapAll\(\)/.test(src));
}

console.log(`\n合计 ${pass + fail} 条：${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
