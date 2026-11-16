// Bouquet2D desktop app: starts the bundled C++ server (which also serves the app) on a free local port
// and shows the app in a window. The server stops when the app quits.
const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

// The app's files and server: the repository around this folder (npm start), or the packaged copy
// (see "extraResources" in package.json)
const root = app.isPackaged ? path.join(process.resourcesPath, 'bouquet') : path.join(__dirname, '..');
const serverPath = path.join(root, 'server', process.platform === 'win32' ? 'server.exe' : 'server');

let server = null;
let serverLog = '';

function freePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.on('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

// Resolves to the app's URL once the server answers /health; rejects if it fails to start or stops
async function startServer() {
    const port = await freePort();
    const url = `http://127.0.0.1:${port}/`;
    // stdin stays open as long as this app runs: the server exits when it closes (EXIT_ON_STDIN_EOF)
    const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', EXIT_ON_STDIN_EOF: '1' };
    server = spawn(serverPath, [], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const keep = data => { serverLog = (serverLog + data).slice(-4000); };
    server.stdout.on('data', keep);
    server.stderr.on('data', keep);
    let failure = null;
    server.once('error', err => { failure = `could not run ${serverPath} (${err.message})`; });
    server.once('exit', code => { failure ??= `the server stopped (exit code ${code})`; });
    for (const deadline = Date.now() + 30000; Date.now() < deadline;) {
        if (failure) throw new Error(failure);
        try {
            if ((await fetch(`${url}health`)).ok) return url;
        } catch {
            // not listening yet
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('the server did not answer within 30 s');
}

function createWindow(url) {
    const win = new BrowserWindow({ width: 1600, height: 1000, title: 'Bouquet2D', backgroundColor: '#ffffff' });
    // Links out of the app (e.g. the footer's) open in the default browser
    const external = target => {
        if (/^https?:/.test(target) && !target.startsWith(url)) shell.openExternal(target);
    };
    win.webContents.setWindowOpenHandler(({ url: target }) => {
        external(target);
        return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, target) => {
        if (!target.startsWith(url)) {
            event.preventDefault();
            external(target);
        }
    });
    win.loadURL(url);
}

app.whenReady().then(async () => {
    try {
        createWindow(await startServer());
    } catch (err) {
        dialog.showErrorBox('Bouquet2D could not start', `${err.message}\n\n${serverLog}`.trim());
        app.quit();
    }
});

// The app is its one window: closing it quits, on macOS too
app.on('window-all-closed', () => app.quit());
app.on('quit', () => server?.kill());
