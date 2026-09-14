const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    minWidth: 900,
    minHeight: 700,
    resizable: true,
    frame: true,
    autoHideMenuBar: true,
    backgroundColor: '#0a0e1a',
    icon: path.join(__dirname, 'icon.png')
    // webPreferences 保持 Electron 默认安全基线（nodeIntegration=false、
    // contextIsolation=true）。渲染进程是纯前端，全部逻辑走 Canvas + localStorage，
    // 不需要任何 Node 能力，因此没有放开任何一条。
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  // 开发时打开开发者工具
  // win.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
