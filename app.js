const electron = require('electron');
const app = electron.app;

const path = require('path');
const fs = require('fs');
const BrowserWindow = electron.BrowserWindow;
var ipc = electron.ipcMain;
var mainWindow = null;
const LocalServer = require('./localserver.js');
var localServer = new LocalServer();
localServer.listen();

app.commandLine.appendSwitch('ignore-certificate-errors', 'true');

function restart() {
  var app = require('app');
  var spawn = require('child_process').spawn;
  var newProcess = spawn(process.execPath, ['.'], {
    stdio: 'inherit'
  });
  app.quit();
}

ipc.on('update', function(event) {
  console.log('update request received');
});

ipc.on('close', function(event) {
  mainWindow.close();
});

ipc.on('message', function(event) {
  if(!mainWindow.isFocused()) {
    mainWindow.flashFrame(true);
  }
});

ipc.on('maximize', function(event) {
  if(mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  }
  else {
    mainWindow.maximize();
  }
});

ipc.on('minimize', function(event) {
  mainWindow.minimize();
});

ipc.on('localmirror-request', function(event) {
  electron.dialog.showOpenDialog(mainWindow, {
    title: 'Select local mirror',
    filters: [
      { name: 'Videos', extensions: ['mp4', 'mkv', 'webm', 'ogg'] },
      { name: 'All Files', extensions: ['*']}
    ],
    properties: ['openFile']
  }, function(results) {
    if(results) {
      localServer.setLocalSource(results[0]);
      event.sender.send('localmirror-response', 'http://localhost:' + localServer.server.address().port + '/');
    }
  });
});

ipc.on('settings-maximized', function(event, maximized) {
  if(maximized === 'true') {
    mainWindow.maximize();
  }
});

ipc.on('settings-bounds', function(event, bounds) {
  mainWindow.setBounds(bounds);
});

ipc.on('window-show', function(event) {
  mainWindow.show();

  // TODO - make async
  var version = fs.readFileSync(path.join(app.getAppPath(), 'version.txt'), 'utf-8').trim();
  mainWindow.webContents.send('check-update', version);
});

app.on('window-all-closed', function() {
  app.quit();
});

app.on('ready', function() {
  openWindow();

  var ret = electron.globalShortcut.register('f7', function() {
    if(mainWindow.isFocused()) {
      mainWindow.close();
      openWindow();
      mainWindow.webContents.openDevTools();
    }
  });
});

function openWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 768,
    minHeight: 281,
    frame: false,
    show: false
  });
  mainWindow.loadURL('file://' + __dirname + '/index.html');
  mainWindow.webContents.openDevTools();

  mainWindow.on('move', function() {
    saveBounds();
  });

  mainWindow.on('resize', function(e) {
    saveBounds();
  });

  mainWindow.on('maximize', function() {
    mainWindow.webContents.send('settings-maximized', true);
  });

  mainWindow.on('unmaximize', function() {
    mainWindow.webContents.send('settings-maximized', false);
  });
}

function saveBounds() {
  mainWindow.webContents.send('settings-bounds', mainWindow.getBounds());
}
