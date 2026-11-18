// The rules behind how controls feel and read aloud: when a haptic fires, and what is spoken.
import { pastThreshold, reachedDetent } from '../src/ui/feel';
import { actionDir, percentText, positionText, stepFraction, stepFrequency, stepValue, stretchText } from '../src/ui/spoken';
import { db } from '../src/ui/theme';

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

test('levels are spoken in dB with a real minus sign', () => {
  assert.equal(db(-3.5, 1), '−3.5 dB');
  assert.equal(db(2, 1), '+2.0 dB');
  assert.equal(db(0, 1), '0.0 dB');
});
test('a place in a track is spoken as a time, not a percentage', () => {
  assert.equal(positionText(42, 190), '0:42 of 3:10');
  assert.equal(positionText(500, 190), '3:10 of 3:10');
  assert.equal(stretchText(30, 20), '0:30 to 0:50');
  assert.equal(percentText(0.416), '42 percent');
});
test('one flick moves a seek bar a twentieth of the track and stops at the ends', () => {
  assert.equal(stepFraction(0.5, 1), 0.55);
  assert.equal(stepFraction(0.5, -1), 0.45);
  assert.equal(stepFraction(0.98, 1), 1);
  assert.equal(stepFraction(0.02, -1), 0);
});
test('one flick moves an EQ point half a dB, within ±12', () => {
  assert.equal(stepValue(-3.5, 1, 0.5, -12, 12), -3);
  assert.equal(stepValue(-3.5, -1, 0.5, -12, 12), -4);
  assert.equal(stepValue(12, 1, 0.5, -12, 12), 12);
});
test('and its frequency a third of an octave, within hearing', () => {
  assert.equal(stepFrequency(1000, 1), 1260);
  assert.equal(stepFrequency(1000, -1), 794);
  assert.equal(stepFrequency(19000, 1), 20000);
  assert.equal(stepFrequency(21, -1), 20);
});
test('only the system\'s increment and decrement move a control', () => {
  assert.equal(actionDir('increment'), 1);
  assert.equal(actionDir('decrement'), -1);
  assert.equal(actionDir('activate'), 0);
});

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
if (failed) process.exit(1);
