/**
 * 用「正确的姿势」起 Electron 去跑某个脚本。
 *
 * 为什么需要这层垫片：有些环境（CI、某些终端、编辑器内嵌终端、别的同学的机器）
 * 会带着 `ELECTRON_RUN_AS_NODE=1`。这个变量会让 electron **退化成纯 Node**，
 * 症状是 `require('electron').app === undefined`，报
 *   Cannot read properties of undefined (reading 'commandLine')
 *
 * 直接写 `electron scripts/xxx.js` 时没人替你擦掉它 —— 于是同一个命令
 * 「在我机器上好好的、在别人机器上就崩」，而且报错信息完全看不出原因。
 * 这里统一擦掉再起，顺便保证退出码原样透传（CI 里要靠它判断成败）。
 *
 *   node scripts/electron-run.mjs scripts/screenshot.js [更多参数…]
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// 在纯 Node 里，require('electron') 返回的是 electron 可执行文件的路径
const electronPath = require('electron');

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('用法：node scripts/electron-run.mjs <要交给 electron 跑的脚本> [参数…]');
  process.exit(2);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;   // ← 就这一行是重点

const child = spawn(electronPath, args, { stdio: 'inherit', env });
child.on('error', (e) => { console.error('Electron 起不来：', e.message); process.exit(1); });
child.on('exit', (code, signal) => {
  if (signal) { console.error('Electron 被信号中断：', signal); process.exit(1); }
  process.exit(code ?? 1);
});
