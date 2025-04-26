import whyIsNodeRunning from 'why-is-node-running'; // should be your first import

import { execa } from 'execa';
import nodeFs from 'node:fs/promises';
import nodePath from 'node:path';
import { test } from 'vitest';

import WebSocket from 'ws';

async function copyProjectToTmp(projectName: string) {
  const projectPath = nodePath.resolve(__dirname, `fixtures/${projectName}`);
  const tmpProjectPath = nodePath.resolve(
    __dirname,
    `tmp/fixtures/${projectName}`,
  );

  // Copy project to temp directory. Remember to filter out `node_modules` and `dist` directories
  await nodeFs.mkdir(tmpProjectPath, { recursive: true });
  await nodeFs.cp(projectPath, tmpProjectPath, {
    recursive: true,
    filter: (src) => {
      return !src.includes('node_modules') && !src.includes('dist');
    },
  });
}

test('basic', async () => {
  const tmpFixturesPath = nodePath.resolve(__dirname, 'tmp/fixtures');

  const projectName = 'basic';
  const tmpProjectPath = nodePath.join(
    tmpFixturesPath,
    projectName,
  );

  await nodeFs.rm(tmpFixturesPath, { recursive: true, force: true });
  await copyProjectToTmp(projectName);
  await execa('pnpm install', {
    cwd: tmpProjectPath,
    shell: true,
    stdio: 'inherit',
  });

  const devServeProcess = execa('pnpm serve', {
    cwd: tmpProjectPath,
    shell: true,
    stdio: 'inherit',
    env: {
      RUST_BACKTRACE: 'FULL',
      RD_LOG: 'hmr=debug',
    },
  });

  const addr = new URL('ws://localhost:3000');
  const ws = await ensureDevServerWsConnectionOf(addr);

  const runningArtifactProcess = execa(
    `node ${nodePath.join(tmpProjectPath, 'dist/main.js')}`,
    { cwd: tmpProjectPath, shell: true, stdio: 'inherit' },
  );

  await ensureHmrClientConnectedDevServer(ws);

  // const _runningArtifactExistWithZeroPromise = new Promise((rsl, rej) => {
  //   runningArtifactProcess.on('exit', (code) => {
  //     if (code !== 0) {
  //       rej(new Error(`runningNodeProcess exited with code ${code}`));
  //     }
  //     rsl({});
  //   });
  // });

  const checkIfOkFileExist = () =>
    new Promise<void>((rsl) => {
      function check() {
        setTimeout(async () => {
          const okFilePath = nodePath.join(tmpProjectPath, 'ok');
          try {
            await nodeFs.access(okFilePath);
            rsl();
          } catch {
            check();
          }
        }, 500);
      }
      check();
    });

  const originalFilePath = nodePath.resolve(
    tmpProjectPath,
    'src/hmr-boundary.js',
  );

  await nodeFs.writeFile(
    originalFilePath,
    `import { value as depValue } from './new-dep';
export const value = depValue;

import.meta.hot.accept((newExports) => {
  globalThis.hmrChange(newExports);
});
console.log('HMR boundary file changed');
`,
  );

  console.debug('Waiting for HMR to be triggered...');
  await checkIfOkFileExist();
  console.debug('Successfully triggered HMR');
  whyIsNodeRunning();

  try {
    runningArtifactProcess.kill('SIGINT');
    await runningArtifactProcess;
  } catch (err: any) {
    if (err.signal === 'SIGINT') {
      console.log('Process killed normally with SIGINT, ignoring error.');
    } else {
      throw err; // 其他真正的错误继续抛出
    }
  }
  whyIsNodeRunning();
  console.log('😈😈1');
  try {
    devServeProcess.kill('SIGINT');
    await devServeProcess;
  } catch (err: any) {
    if (err.signal === 'SIGINT') {
      console.log('Process killed normally with SIGINT, ignoring error.');
    } else {
      throw err; // 其他真正的错误继续抛出
    }
  }
  whyIsNodeRunning();
  console.log('😈😈2');
});

async function ensureDevServerWsConnectionOf(
  url: URL,
  timeout = 5000,
  interval = 300,
): Promise<WebSocket> {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = new WebSocket(url);

      socket.on('open', () => {
        resolve(socket);
      });

      socket.on('error', () => {
        if (Date.now() - start > timeout) {
          reject(new Error(`Timeout: Unable to connect to ${url}`));
        } else {
          setTimeout(tryConnect, interval);
        }
      });
    };

    tryConnect();
  });
}

function ensureHmrClientConnectedDevServer(ws: WebSocket) {
  let isConnected = false;
  return new Promise<void>((resolve, reject) => {
    ws.on('message', (message) => {
      const msg = JSON.parse(message.toString());
      if (msg.type === 'connected-from-hmr-runtime') {
        isConnected = true;
        resolve();
      }
    });
    ws.on('error', (err) => {
      reject(err);
    });
    setTimeout(() => {
      if (!isConnected) {
        reject(new Error('Timeout: HMR client did not connect to dev server'));
      }
    }, 5000);
  });
}
