import { prisma } from '@aishorts/shared';
import { ingest } from './ingest';
import { summarizePending } from './summarize';

// Full pipeline run: pull feeds, then summarize new items into pending cards.
async function main() {
  console.log('== AIShorts content pipeline ==');
  console.log('1) Ingesting RSS sources...');
  await ingest();
  console.log('2) Summarizing new items with Claude...');
  await summarizePending();
  console.log('Done. Review pending cards in the admin panel before publishing.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
