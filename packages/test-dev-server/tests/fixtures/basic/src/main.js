import assert from 'node:assert';
import nodeFs from 'node:fs';
import { value } from './hmr-boundary';

assert(value, 1);

globalThis.hmrChange = (exports) => {
  console.log('HMR change detected');
  assert(exports.value, 2);
  nodeFs.writeFileSync('./ok', '');
  process.exit(0);
};
