import readline from 'node:readline';
import bcrypt from 'bcryptjs';
import { prisma } from '@aishorts/shared';

// Create (or update) an admin operator in the admin_users table.
//
//   npm run -w @aishorts/api create-admin
//   npm run -w @aishorts/api create-admin -- --email you@x.com --name "You" --password secret
//
// Prefer the interactive prompt so the password never lands in your shell history.
// Re-running with an existing email updates that operator's name/password.

type Args = { email?: string; name?: string; password?: string };

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email') out.email = argv[++i];
    else if (a === '--name') out.name = argv[++i];
    else if (a === '--password') out.password = argv[++i];
  }
  return out;
}

function ask(question: string, opts: { mask?: boolean } = {}): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    if (opts.mask) {
      // Suppress echo so the typed password isn't shown on screen.
      const out = process.stdout;
      const onData = () => out.write(`\r${question}`);
      (rl as any)._writeToOutput = () => {};
      out.write(question);
      rl.question('', (answer) => {
        rl.close();
        out.write('\n');
        process.stdin.removeListener('data', onData);
        resolve(answer);
      });
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const email = (args.email ?? (await ask('Email: '))).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('Invalid email address.');
    process.exit(1);
  }
  const name = (args.name ?? (await ask('Name (optional): '))).trim() || null;
  const password = args.password ?? (await ask('Password: ', { mask: true }));
  if (!password || password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.adminUser.upsert({
    where: { email },
    create: { email, name, passwordHash, active: true },
    update: { name, passwordHash, active: true },
  });
  console.log(`✓ Admin operator saved: ${user.email} (${user.id})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
