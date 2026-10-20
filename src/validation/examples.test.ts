import { expect, it } from 'vitest';
import annotation from '../../docs/validation/examples/synthetic.annotation.json';
import run from '../../docs/validation/examples/synthetic.run.json';
import saved from '../../docs/validation/examples/synthetic.report.json';
import { compare } from './compare';
import { parseAnnotation, parseRun } from './schema';

it('reproduces the saved synthetic report without a model or recording', () => {
  const report = compare(parseAnnotation(annotation), parseRun(run));
  expect(report).toEqual(saved);
  expect(report.count).toMatchObject({ absoluteError: 1, missed: 1, extra: 1 });
  expect(report.criteria.lean).toMatchObject({ tp: 1, fp: 2, fn: 0, latencyMs: { mean: 400 } });
  expect(report.criteria.depth).toMatchObject({ fn: 1 });
  expect(report.evidence).toBe('synthetic-only');
});
