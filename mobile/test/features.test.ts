// The parts of the newer features that are plain sums: where a slider's bubble sits, what undo
// puts back, how an artist's profile reaches a song, and when each lyric line shows on a snippet.
import { BUBBLE_HEIGHT, BUBBLE_MARGIN, bubblePlace } from '../src/ui/bubble';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
}

// ---------- The slider's value bubble ----------
{
  // A 300-point slider starting 60 points in on a 402-point phone, well down the page.
  const held = { left: 60, top: 400 };
  const mid = bubblePlace(150, 52, held, 40, 402);
  check('the bubble is centred over the thumb', mid.left === 150 - 26, `${mid.left}`);
  check('and sits wholly above it', !mid.below && mid.top + BUBBLE_HEIGHT <= 40 / 2 - 9, `${mid.top}`);
  // A full-width slider with its thumb at either end, and a wide value.
  const edge = { left: 4, top: 400 };
  const atStart = bubblePlace(9, 90, edge, 40, 402);
  const atEnd = bubblePlace(394 - 9, 90, edge, 40, 402);
  check('at the left end it stops at the screen edge', edge.left + atStart.left === BUBBLE_MARGIN, `${edge.left + atStart.left}`);
  check('at the right end it stops at the screen edge', edge.left + atEnd.left + 90 === 402 - BUBBLE_MARGIN, `${edge.left + atEnd.left + 90}`);
  const top = bubblePlace(150, 52, { left: 60, top: 10 }, 40, 402);
  check('with no room above, it goes under the thumb', top.below && top.top >= 40 / 2 + 9, `${top.top}`);
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
