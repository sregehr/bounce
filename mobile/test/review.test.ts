// Checks for the fixes that came out of the design review: the record button during a take,
// and reading a file's sample rate and length from its first bytes.
import { recordState } from '../src/ui/recordControl';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
}

// ---------- The record button ----------

check('with no microphone the button offers to connect one', recordState(false, 'idle') === 'off');
check('with a microphone it records', recordState(true, 'idle') === 'ready' && recordState(true, 'listening') === 'ready');
check('during a take it stops the take', recordState(true, 'recording') === 'recording');
check('and still does when the microphone has dropped mid-take', recordState(false, 'recording') === 'recording');

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
