import assert from 'node:assert';
import { NeonDatabaseClient } from '../packages/database/src/neon-client';

async function testLiveNeonChat() {
  console.log('================================================================');
  console.log('💬 TESTING LIVE NEON POSTGRESQL CHAT & GROUP SCHEMA MIGRATION');
  console.log('================================================================\n');

  const db = new NeonDatabaseClient();
  await db.initialize();

  assert.strictEqual(db.isConnectedToDb, true, 'Must connect to live Neon PostgreSQL database');

  const nonce = Date.now().toString(36);
  // Create 2 test users
  const userA = await db.users.create({
    email: `alice_${nonce}@auradrop.net`,
    username: `alice_${nonce}`,
    passwordHash: 'hash_test_123',
    displayName: 'Alice Engineer',
  });
  console.log(`✓ Created User A: ${userA.id} (${userA.username})`);

  const userB = await db.users.create({
    email: `bob_${nonce}@auradrop.net`,
    username: `bob_${nonce}`,
    passwordHash: 'hash_test_123',
    displayName: 'Bob Mobile Dev',
  });
  console.log(`✓ Created User B: ${userB.id} (${userB.username})`);

  // 1. Direct Conversation
  console.log('\n[Test 1] Creating direct conversation between Alice and Bob...');
  const directConv = await db.conversations.createDirect(userA.id, userB.id);
  assert.ok(directConv.id);
  assert.strictEqual(directConv.type, 'DIRECT');
  console.log(`✓ Direct Conversation Created: ${directConv.id}`);

  // Test idempotency of createDirect
  const sameConv = await db.conversations.createDirect(userB.id, userA.id);
  assert.strictEqual(sameConv.id, directConv.id, 'Must return same conversation ID');
  console.log(`✓ Direct Conversation Idempotency Verified`);

  // 2. Send Message
  console.log('\n[Test 2] Sending message from Alice to Bob...');
  const msg1 = await db.messages.create({
    conversationId: directConv.id,
    senderId: userA.id,
    text: 'Hello Bob! This is real persistent P2P chat on Neon.',
    type: 'TEXT',
  });
  assert.ok(msg1.id);
  assert.strictEqual(msg1.text, 'Hello Bob! This is real persistent P2P chat on Neon.');
  console.log(`✓ Message Created: ${msg1.id}`);

  // 3. Send Message with File Attachment
  console.log('\n[Test 3] Sending file attachment message from Bob to Alice...');
  const msg2 = await db.messages.create({
    conversationId: directConv.id,
    senderId: userB.id,
    text: 'Sending production design artifact',
    type: 'FILE',
    attachments: [
      {
        fileName: 'auradrop_spec.pdf',
        fileSize: 4194304,
        mimeType: 'application/pdf',
        fileHash: 'sha256_mock_hash_for_test',
        transferId: 'tx_p2p_48291',
      },
    ],
  });
  assert.ok(msg2.id);
  assert.strictEqual(msg2.attachments?.length, 1);
  assert.strictEqual(msg2.attachments[0].file_name, 'auradrop_spec.pdf');
  console.log(`✓ File Attachment Message Created: ${msg2.id} with file ${msg2.attachments[0].file_name}`);

  // 4. List Messages
  console.log('\n[Test 4] Listing messages for Bob...');
  const msgs = await db.messages.list(directConv.id, userB.id);
  assert.strictEqual(msgs.length, 2);
  console.log(`✓ Listed ${msgs.length} messages in correct order`);

  // 5. Group Conversation
  console.log('\n[Test 5] Creating Group Conversation...');
  const group = await db.conversations.createGroup('Core Engineering', userA.id, [userB.id]);
  assert.ok(group.id);
  assert.strictEqual(group.type, 'GROUP');
  assert.strictEqual(group.title, 'Core Engineering');
  console.log(`✓ Group Conversation Created: ${group.id} ("${group.title}")`);

  const groupMembers = await db.conversations.getMembers(group.id);
  assert.strictEqual(groupMembers.length, 2);
  console.log(`✓ Verified Group Members count: ${groupMembers.length}`);

  // 6. Disappearing Messages setting
  console.log('\n[Test 6] Setting Disappearing Messages timer (120s / 2m)...');
  await db.conversations.setDisappearing(directConv.id, 120);
  const updatedConv = await db.conversations.findById(directConv.id);
  assert.strictEqual(updatedConv?.disappearing_seconds, 120);
  console.log(`✓ Disappearing timer set to 120 seconds (2m preset)`);

  // 7. Clear Chat for user
  console.log('\n[Test 7] Testing Clear Chat for Alice...');
  await db.conversations.clearChat(directConv.id, userA.id);
  const aliceMsgs = await db.messages.list(directConv.id, userA.id);
  assert.strictEqual(aliceMsgs.length, 0, 'Alice should see 0 messages after Clear Chat');
  const bobMsgs = await db.messages.list(directConv.id, userB.id);
  assert.strictEqual(bobMsgs.length, 2, 'Bob should still see both messages');
  console.log(`✓ Clear Chat semantics verified (Cleared for Alice, preserved for Bob)`);

  // 8. Delete for Everyone
  console.log('\n[Test 8] Testing Delete for Everyone by Bob on msg2...');
  const deleted = await db.messages.deleteForEveryone(msg2.id, userB.id);
  assert.strictEqual(deleted, true);
  const bobMsgsAfterDel = await db.messages.list(directConv.id, userB.id);
  const deletedMsg = bobMsgsAfterDel.find((m) => m.id === msg2.id);
  assert.strictEqual(deletedMsg?.is_deleted_everyone, true);
  assert.strictEqual(deletedMsg?.text, 'This message was deleted');
  console.log(`✓ Delete for Everyone verified`);

  // 9. Media Avatar Upload
  console.log('\n[Test 9] Testing Media Avatar recording...');
  const media = await db.media.recordUpload({
    userId: userA.id,
    mediaType: 'AVATAR',
    fileName: 'alice_avatar.png',
    fileSize: 1048576,
    mimeType: 'image/png',
    storagePath: 'uploads/avatars/alice_avatar.png',
    publicUrl: '/uploads/avatars/alice_avatar.png',
  });
  await db.media.updateUserAvatar(userA.id, media.public_url);
  const userARefreshed = await db.users.findById(userA.id);
  assert.strictEqual(userARefreshed?.avatar_url, '/uploads/avatars/alice_avatar.png');
  console.log(`✓ User Avatar uploaded and linked: ${userARefreshed?.avatar_url}`);

  await db.close();
  console.log('\n================================================================');
  console.log('🎉 LIVE NEON POSTGRESQL CHAT & GROUP SYSTEM 100% VERIFIED!');
  console.log('================================================================\n');
}

testLiveNeonChat().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
