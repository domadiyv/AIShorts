import { prisma } from '@aishorts/shared';
import { runPipeline } from './pipeline';

// CLI entry point. The same pipeline is also triggerable from the admin panel
// (POST /v1/admin/refresh) — both call runPipeline().
async function main() {
  console.log('== AIShorts content pipeline ==');
  await runPipeline();
  console.log('Review pending cards in the admin panel before publishing.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
