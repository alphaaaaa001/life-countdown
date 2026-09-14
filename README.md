<div align="center">

# 🚀 人生倒计时 · Life Countdown

**把「剩下的时间」画成一条心电图**

输入出生日期和预期寿命，它把余生拆成天、时、分、秒，并在背景上画一条**会心跳**的心电曲线。

![Electron](https://img.shields.io/badge/Electron-28-47848F?logo=electron&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)
![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows&logoColor=white)
![Dependencies](https://img.shields.io/badge/runtime%20deps-0-brightgreen)

![心跳线示意](docs/ecg-waveform.svg)

</div>

---

## 心跳线：波不是「铺」在那里的，是「长」出来的

大多数倒计时 App 的装饰性波形，本质是一张**会滚动的壁纸**：波形永远铺满整屏，再把一个小光点放上去骑着它跑。

真实的 ECG 不是这样。**心脏先电激动，描记笔才在纸上拖出波形**。所以这里做成了「笔尖描记」模型：

- 屏幕正中一颗**笔尖**（发光点）。心脏每搏动一次，笔尖才当场描出一个波形包；
- 描下的墨迹**留在原地**，以 157.9 px/s 缓慢向左漂移，像纸上干掉的旧墨迹——越远越淡；
- 笔尖**还没走到的右半边是空的**（连波形都没有）。所以启动的第一秒，屏幕是干净的，波形是一拍一拍「长」出来的；
- 想手动来一下？**点画面任意处，当场「咚」一下**，并伴随一圈从笔尖荡开的脉冲。

波形本身照着标准 12 导联心电图的长相来（P 波 → PR 段 → QRS 波群 → ST 段 → T 波 → U 波）：

| 波形 | 相位 | 振幅系数 | 含义 |
|---|---|---|---|
| **P** | 0.048 | `+0.10` | 心房除极，小丘 |
| **PR 段** | 0.078–0.130 | `0` | 回到基线，等激动传到心室 |
| **Q** | 0.152 | `−0.12` | QRS 前的小下陷 |
| **R** | 0.172 | **`+1.00`** | 最高尖峰 ← **「咚」的就是这一下** |
| **S** | 0.194 | `−0.40` | 紧跟其后的深谷 |
| **ST 段** | 0.226–0.268 | `0` | 回到基线 |
| **T** | 0.312 | `+0.26` | 心室复极，小丘 |
| **U** | 0.420 | `+0.08` | 常被忽略的小丘 |

> 图里的 `docs/ecg-waveform.svg` 不是手画的，是 `npm run figure` 跑的 —— 脚本会从 `script.js` 里**把同一份纯函数整块抽出来**逐像素算，所以参数一改图就跟着变，不会和代码对不上。

---

## 功能

- **余生倒计时**：从今天算到「出生日期 + 预计寿命」那一秒，天/时/分/秒实时跳
- **人生进度条**：`已度过年龄 / 预计寿命`
- **健康风险提示**：预计寿命 ≥ 70 岁时给出心血管、睡眠、亚健康等条目
- **心跳线**：见上，笔尖描记式 ECG + 点击手动「咚」
- **明暗双主题**：右上角一键切换，选择记在 localStorage 里
- **数据本地留存**：关掉再打开，倒计时接着走

---

## 快速开始

```bash
npm install
npm start          # 启动 Electron
npm run build      # 打包成 Windows 安装包（electron-builder / NSIS）
```

没有 Electron 环境，也可以直接开 `index.html` —— 它不依赖任何 Node 能力，就是个普通网页。

---

## 调参：把心跳调成你喜欢的样子

所有参数集中在 `script.js` 顶部，注释里写了各自作用：

| 参数 | 现值 | 作用 |
|---|---|---|
| `ECG_PERIOD_MS` | `1900` | 心搏周期，越大越慢（1900 ms ≈ **31.6 bpm**，一种「弱弱的心跳」） |
| `ECG_AMPL` | `78` | R 峰高度（px） |
| `ECG_PEN_FRAC` | `0.5` | 笔尖水平位置（0 = 最左，1 = 最右） |
| `ECG_BEAT_W` | `300` | 一次心搏占多少屏幕宽度（px），漂移速度由它和周期推出 |
| `ECG_FIRST_BEAT` | `0.55` | 首拍延迟（秒），先静一息再「咚」 |
| `ECG_PULSE_MS` | `620` | 「咚」的脉冲圈时长（ms） |

不想改代码试参数，开 **`heartbeat-preview.html`** —— 独立预览页，有「更慢 / 更快 / 复位 / 清空重来 / 手动咚」，并实时显示笔尖位置、已印下心搏数、实测心搏间隔。挑好节奏再把数值填回 `script.js`。

---

## 目录结构

```
life-countdown/
├─ main.js                 Electron 主进程（窗口、图标、安全基线）
├─ index.html              界面结构
├─ style.css               太空舱风格样式 + 双主题变量
├─ script.js               业务逻辑
│   ├─ 心跳线（笔尖描记式 ECG）  ← 本项目的核心
│   └─ 倒计时 / 年龄 / 进度 / 健康提示
├─ heartbeat-preview.html  心跳线调参预览页（开发用）
├─ scripts/
│   └─ gen-ecg-svg.mjs     从 script.js 抽真实实现 → 生成 README 示意图
├─ docs/
│   └─ ecg-waveform.svg    自动生成的波形示意
├─ icon.png / icon.ico     应用图标
└─ package.json
```

---

## 工程笔记：几处容易被忽略的取舍

**1. 日期按本地时区解析，不用 `new Date('2005-03-15')`**

`new Date('YYYY-MM-DD')` 会按 **UTC 午夜**解析，在东八区就变成当天 08:00 —— 倒计时终点整体偏 8 小时。所以手动拆字段构造本地 `00:00`：

```js
function parseLocalDate(str) {
  const [y, m, d] = String(str).split('-').map(Number);
  return new Date(y, m - 1, d);
}
```

**2. 年龄只在「今年生日还没到」时减 1**

```js
if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age--;
```

注意这里用的是**用户选择的出生日期**去推年龄，而不是让用户自己填年龄 —— 手填年龄再叠加生日判断，很容易多算或少算一整年。

**3. 全屏画布只有一个 rAF 主循环独占**

心跳线每帧 `clearRect` 整个画布。如果有第二个定时器也来擦同一块画布，两者会互相抹掉对方的内容，表现为闪烁撕裂。所以动画只有一个入口：`heartbeatFrame()` 末尾 `requestAnimationFrame` 自己。

**4. Electron 保持默认安全基线**

渲染进程是纯前端（Canvas + localStorage），全项目没有一处 `require` / `process` / `__dirname`。既然不用，就没有理由打开 `nodeIntegration` —— 少一个攻击面，而且零收益。

**5. 纯函数区和 DOM 区分开**

`script.js` 里有一段用 `// >>> ECG_PURE_MATH_BEGIN` 标记的纯函数区，不引用任何 DOM。好处是测试脚本和图生成脚本可以**把这一段整块抽出来跑**，验的是真实现而不是记忆里的实现。

---

## License

[MIT](LICENSE)
