import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { compare } from '../../src/validation/compare.ts';
import { parseAnnotation, parseRun } from '../../src/validation/schema.ts';

const [annotationPath, runPath, outputPath, ...extra] = process.argv.slice(2);
if (!annotationPath || !runPath || !outputPath || extra.length) {
  console.error('Usage: npm run validation:report -- annotation.json run.json validation-private/report.json');
  process.exitCode = 1;
} else {
  try {
    const privateRoot = resolve('validation-private');
    const output = resolve(outputPath);
    const inside = relative(privateRoot, output);
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('Write reports inside validation-private/');
    if ([annotationPath, runPath].some(input => resolve(input) === output)) throw new Error('Output must not overwrite evidence');
    const annotation = parseAnnotation(JSON.parse(await readFile(annotationPath, 'utf8')));
    const run = parseRun(JSON.parse(await readFile(runPath, 'utf8')));
    const report = compare(annotation, run);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ evidence: report.evidence, split: report.split, clipId: report.clipId, count: report.count, output: outputPath }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
