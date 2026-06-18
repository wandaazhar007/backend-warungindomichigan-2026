/**
 * One-time script: set role=admin custom claim on a Firebase user.
 * Usage: npx ts-node --project tsconfig.json scripts/set-admin.ts <email>
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { admin } from '../src/config/firebase';

const email = process.argv[2];

if (!email) {
  console.error('Usage: npx ts-node --project tsconfig.json scripts/set-admin.ts <email>');
  process.exit(1);
}

async function main() {
  try {
    const user = await admin.auth().getUserByEmail(email);
    await admin.auth().setCustomUserClaims(user.uid, {
      role: 'admin',
      adminRole: 'SUPER_ADMIN',
    });
    console.log(`✅ Admin claims set for: ${email} (uid: ${user.uid})`);
    console.log('   role: admin, adminRole: SUPER_ADMIN');
    console.log('\nSekarang login ulang di halaman admin — token lama perlu di-refresh dulu.');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('❌ Error:', msg);
    process.exit(1);
  }
}

main();
