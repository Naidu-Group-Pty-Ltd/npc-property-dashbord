import esbuild from 'esbuild';
import { readFileSync } from 'node:fs';
let bad = 0;
for (const f of process.argv.slice(2)) {
  try {
    await esbuild.transform(readFileSync(f, 'utf8'), { loader: 'ts', sourcefile: f });
    console.log('OK  ', f);
  } catch (e) {
    bad++;
    console.log('FAIL', f);
    for (const err of e.errors ?? []) console.log('     ', err.location?.line, err.text);
  }
}
process.exit(bad ? 1 : 0);
