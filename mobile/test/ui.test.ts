// The rules behind how controls feel and read aloud: when a haptic fires, and what is spoken.
import { pastThreshold, reachedDetent } from '../src/ui/feel';

let failed = 0;
const assert = {
  equal<T>(got: T, want: T) {
    if (got !== want) throw new Error(`got ${String(got)}, wanted ${String(want)}`);
  },
};
function test(name: string, run: () => void) {
  try {
    run();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

test('a slider is felt when it arrives at its resting point', () => {
  assert.equal(reachedDetent(1.5, 0, [0]), true);
  assert.equal(reachedDetent(-0.5, 0, [0]), true);
});
test('and when a fast drag passes straight through it', () => {
  assert.equal(reachedDetent(-2, 3, [0]), true);
  assert.equal(reachedDetent(3, -2, [0]), true);
});
test('but not when it leaves it, sits on it, or moves elsewhere', () => {
  assert.equal(reachedDetent(0, 0.5, [0]), false);
  assert.equal(reachedDetent(0, 0, [0]), false);
  assert.equal(reachedDetent(2, 3, [0]), false);
  assert.equal(reachedDetent(2, 3, []), false);
});
test('a drag across a control is felt once, not on every move', () => {
  const path = [-6, -4.5, -3, -1.5, 0, 1.5, 3, 4.5, 6];
  let felt = 0;
  for (let i = 1; i < path.length; i++) if (reachedDetent(path[i - 1], path[i], [0])) felt++;
  assert.equal(felt, 1);
});
test('a swiped row is past its threshold once pulled beyond it', () => {
  assert.equal(pastThreshold(false, -40, -46), false);
  assert.equal(pastThreshold(false, -47, -46), true);
});
test('and a finger resting on the line does not flip it back and forth', () => {
  let past = false;
  let flips = 0;
  for (const x of [-44, -47, -45, -47, -44, -48, -45]) {
    const next = pastThreshold(past, x, -46);
    if (next !== past) flips++;
    past = next;
  }
  assert.equal(flips, 1);
  assert.equal(pastThreshold(true, -30, -46), false);
});

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
if (failed) process.exit(1);
