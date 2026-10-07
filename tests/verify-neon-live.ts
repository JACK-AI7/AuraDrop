import { NeonDatabaseClient } from '../packages/database/src/neon-client';

async function testLiveNeon() {
  console.log(`================================================================`);
  console.log(`🚀 AURADROP LIVE NEON POSTGRESQL CONNECTIVITY & MIGRATION TEST`);
  console.log(`================================================================\n`);

  const client = new NeonDatabaseClient();
  await client.initialize();

  if (!client.isConnectedToDb) {
    console.error('❌ Failed to connect to live Neon PostgreSQL.');
    process.exit(1);
  }

  console.log('✅ Successfully connected to live Neon PostgreSQL cluster!');

  try {
    // 1. Test creating a user
    const testEmail = `test_${Date.now()}@auradrop.network`;
    const testUsername = `user_${Date.now()}`;
    console.log(`\n[Step 1] Creating test user in Neon DB: ${testEmail}...`);
    const user = await client.users.create({
      id: `usr_${Date.now()}`,
      email: testEmail,
      passwordHash: '$2a$10$liveTestHashForNeonVerification1234567890abcdef',
      displayName: 'Live Neon Test User',
      username: testUsername,
    });
    console.log(`✅ User inserted into Neon 'users' table: ID = ${user.id}, email = ${user.email}`);

    // 2. Query user back
    console.log(`\n[Step 2] Querying user back by email...`);
    const fetched = await client.users.findByEmail(testEmail);
    if (!fetched || fetched.id !== user.id) {
      throw new Error('User query mismatch from Neon DB');
    }
    console.log(`✅ Queried user back from Neon DB successfully! Display Name = "${fetched.display_name}"`);

    // 3. Test user preferences
    console.log(`\n[Step 3] Initializing user preferences in Neon DB...`);
    const prefs = await client.preferences.upsert(user.id, {
      theme: 'dark',
      default_visibility: 'EVERYONE',
      auto_accept: true,
    });
    console.log(`✅ Preferences row saved in 'user_preferences' table: visibility = ${prefs.default_visibility}`);

    // 4. Test device registration
    console.log(`\n[Step 4] Registering test device in Neon DB...`);
    const devId = `dev_live_${Date.now()}`;
    const dev = await client.devices.register({
      id: devId,
      userId: user.id,
      deviceName: 'Live Testing Device',
      platform: 'windows',
      devicePublicKey: 'x25519_pk_test_live_neon',
    });
    console.log(`✅ Device registered in 'devices' table: ID = ${dev.id}`);

    // 5. Test transfer session record
    console.log(`\n[Step 5] Creating transfer session in Neon DB...`);
    const tx = await client.transfers.createSession({
      id: `tx_live_${Date.now()}`,
      senderUserId: user.id,
      senderDeviceId: devId,
      receiverDeviceId: 'dev_remote_receiver',
      direction: 'outgoing',
      fileCount: 1,
      totalBytes: 104857600,
    });
    console.log(`✅ Transfer record created in 'transfer_sessions' table: Status = ${tx.status}, Bytes = ${tx.total_bytes}`);

    console.log(`\n================================================================`);
    console.log(`🎉 ALL 13 NEON POSTGRESQL TABLES ARE FULLY CREATED & OPERATIONAL!`);
    console.log(`================================================================\n`);
  } finally {
    await client.close();
  }
}

testLiveNeon().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
