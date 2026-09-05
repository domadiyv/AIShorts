import { prisma } from '@aishorts/shared';
import { runPurge } from './purge';

// Long-running daemon that fires the purge job once a day at 00:00 IST
// (Asia/Kolkata, a fixed UTC+05:30 with no DST). Runs as its own always-on
// container (see the `scheduler` service in docker-compose.yml); Docker's restart
// policy brings it back after a crash or host reboot, so no host cron/launchd is
// needed and the schedule is independent of the host's timezone.
//
// Midnight IST == 18:30 UTC. We compute the next occurrence in UTC, sleep until
// then, run the purge, and repeat. All arithmetic is in UTC to avoid TZ drift.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // UTC+05:30

// Milliseconds from `now` until the next 00:00 IST.
function msUntilNextIstMidnight(now: number): number {
  const istNow = now + IST_OFFSET_MS;
  const msIntoIstDay = ((istNow % 86_400_000) + 86_400_000) % 86_400_000;
  return 86_400_000 - msIntoIstDay;
}

function istStamp(now: number): string {
  // Format the current instant as IST wall-clock for logging.
  return new Date(now + IST_OFFSET_MS).toISOString().replace('T', ' ').slice(0, 19) + ' IST';
}

async function tick() {
  console.log(`[scheduler] ${istStamp(Date.now())} — running daily purge…`);
  try {
    await runPurge(true);
  } catch (e) {
    // Never let one failed run kill the daemon — log and wait for tomorrow.
    console.error('[scheduler] purge failed:', e);
  }
}

async function main() {
  console.log('[scheduler] started — daily purge at 00:00 IST (Asia/Kolkata).');
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const wait = msUntilNextIstMidnight(Date.now());
    const hrs = (wait / 3_600_000).toFixed(1);
    console.log(`[scheduler] next run in ~${hrs}h (at 00:00 IST).`);
    await new Promise((r) => setTimeout(r, wait));
    await tick();
    // Nudge a second past midnight so rounding can't re-fire the same day.
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

main().catch(async (e) => {
  console.error('[scheduler] fatal:', e);
  await prisma.$disconnect();
  process.exit(1);
});
