import assert from 'node:assert';
import { NeonDatabaseClient } from '../packages/database/src/neon-client';

async function runV18ProductionTest() {
  console.log('================================================================');
  console.log('AURADROP V18 — PRODUCTION CHAT, GROUP, & MEDIA INTEGRATION TEST');
  console.log('================================================================\n');

  const db = new NeonDatabaseClient();
  await db.initialize();

  assert.strictEqual(db.isConnectedToDb, true, 'Must connect to live Neon PostgreSQL database');
  console.log('[STEP 1] Neon DB Live Connectivity: OK');

  const nonce = Date.now().toString(36);

  try {
    // 1. Create 3 Real Users
    console.log('\n[STEP 2] Creating Real Users in Neon DB...');
    const userA = await db.users.create({
      email: `alice_${nonce}@auradrop.net`,
      username: `alice_${nonce}`,
      passwordHash: 'argon2_dummy_hash_alice',
      displayName: 'Alice Engineer',
    });
    console.log(`  ✓ User A created: ${userA.id} (${userA.username})`);

    const userB = await db.users.create({
      email: `bob_${nonce}@auradrop.net`,
      username: `bob_${nonce}`,
      passwordHash: 'argon2_dummy_hash_bob',
      displayName: 'Bob Designer',
    });
    console.log(`  ✓ User B created: ${userB.id} (${userB.username})`);

    const userC = await db.users.create({
      email: `carol_${nonce}@auradrop.net`,
      username: `carol_${nonce}`,
      passwordHash: 'argon2_dummy_hash_carol',
      displayName: 'Carol QA Lead',
    });
    console.log(`  ✓ User C created: ${userC.id} (${userC.username})`);

    // 2. Profile Avatar Media Upload
    console.log('\n[STEP 3] Testing Real Profile Avatar Storage & Initial Fallback...');
    const avatarMedia = await db.media.recordUpload({
      userId: userA.id,
      mediaType: 'AVATAR',
      fileName: 'alice_avatar_photo.png',
      fileSize: 245000,
      mimeType: 'image/png',
      storagePath: `uploads/avatars/alice_${nonce}.png`,
      publicUrl: `/uploads/avatars/alice_${nonce}.png`,
    });
    console.log(`  ✓ Avatar recorded in user_media: ${avatarMedia.id} (${avatarMedia.public_url})`);

    await db.media.updateUserAvatar(userA.id, avatarMedia.public_url);
    const refreshedAlice = await db.users.findById(userA.id);
    assert.strictEqual(refreshedAlice?.avatar_url, avatarMedia.public_url);
    console.log(`  ✓ User profile updated with avatar URL: ${refreshedAlice?.avatar_url}`);

    // Check Carol has NULL avatar (will use deterministic initials 'CP')
    const refreshedCarol = await db.users.findById(userC.id);
    assert.strictEqual(refreshedCarol?.avatar_url, null);
    console.log(`  ✓ Carol has null avatar (uses initials fallback): OK`);

    // 3. Direct Conversation
    console.log('\n[STEP 4] Creating Direct Conversation between Alice and Bob...');
    const directConv = await db.conversations.createDirect(userA.id, userB.id);
    assert.ok(directConv.id);
    assert.strictEqual(directConv.type, 'DIRECT');
    console.log(`  ✓ Direct Conversation Created: ${directConv.id}`);

    // 4. Group Conversation with 3 members
    console.log('\n[STEP 5] Creating Group Conversation with 3 Members...');
    const groupConv = await db.conversations.createGroup(
      'AuraDrop Alpha Core Team',
      userA.id,
      [userB.id, userC.id],
      '/uploads/avatars/group_core.png'
    );
    assert.ok(groupConv.id);
    assert.strictEqual(groupConv.type, 'GROUP');
    assert.strictEqual(groupConv.title, 'AuraDrop Alpha Core Team');
    console.log(`  ✓ Group Created: ${groupConv.id} ("${groupConv.title}")`);

    const members = await db.conversations.getMembers(groupConv.id);
    assert.strictEqual(members.length, 3);
    console.log(`  ✓ Verified Group Members Count: ${members.length} members`);

    // 5. Disappearing Messages Preset (120s / 2 Minutes)
    console.log('\n[STEP 6] Testing Disappearing Messages Preset (120s / 2 Minutes)...');
    await db.conversations.setDisappearing(directConv.id, 120);
    const updatedDirect = await db.conversations.findById(directConv.id);
    assert.strictEqual(updatedDirect?.disappearing_seconds, 120);
    console.log(`  ✓ Conversation disappearing_seconds set to: ${updatedDirect?.disappearing_seconds}s (2m preset)`);

    // Send disappearing message
    const disappearingMsg = await db.messages.create({
      conversationId: directConv.id,
      senderId: userA.id,
      text: 'This sensitive message will self-destruct in 2 minutes',
      type: 'TEXT',
      expiresInSeconds: 120,
    });
    assert.ok(disappearingMsg.id);
    assert.ok(disappearingMsg.expires_at, 'Message must have expires_at set');
    const createdTime = new Date(disappearingMsg.created_at).getTime();
    const expiryTime = new Date(disappearingMsg.expires_at).getTime();
    const deltaSeconds = Math.round((expiryTime - createdTime) / 1000);
    console.log(`  ✓ Disappearing Message Created: ${disappearingMsg.id}, Expiration Delta: ${deltaSeconds}s`);
    assert.ok(Math.abs(deltaSeconds - 120) <= 2, 'Expiration delta must be 120 seconds ±2s');

    // 6. In-Chat File Attachments
    console.log('\n[STEP 7] Testing In-Chat Real File Attachment...');
    const fileMsg = await db.messages.create({
      conversationId: groupConv.id,
      senderId: userB.id,
      text: 'Sharing high-resolution system diagram',
      type: 'FILE',
      attachments: [
        {
          fileName: 'auradrop_network_topology.png',
          fileSize: 8388608, // 8 MB
          mimeType: 'image/png',
          fileHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          fileUrl: '/uploads/attachments/auradrop_network_topology.png',
          transferId: `tx_${nonce}`,
        },
      ],
    });
    assert.ok(fileMsg.id);
    assert.strictEqual(fileMsg.attachments?.length, 1);
    assert.strictEqual(fileMsg.attachments[0].file_name, 'auradrop_network_topology.png');
    assert.strictEqual(fileMsg.attachments[0].file_size, 8388608);
    console.log(`  ✓ File attachment persisted: ${fileMsg.attachments[0].file_name} (${fileMsg.attachments[0].file_size} bytes)`);

    // 7. List messages & verify chronological ordering
    console.log('\n[STEP 8] Listing Group Messages...');
    const groupMsgs = await db.messages.list(groupConv.id, userC.id);
    assert.strictEqual(groupMsgs.length, 1);
    assert.strictEqual(groupMsgs[0].attachments?.length, 1);
    console.log(`  ✓ Group messages fetched: ${groupMsgs.length} message with attachment`);

    // 8. Delete for Everyone
    console.log('\n[STEP 9] Testing "Delete for Everyone"...');
    const msgToDelete = await db.messages.create({
      conversationId: groupConv.id,
      senderId: userA.id,
      text: 'Wait, this contains a typo!',
      type: 'TEXT',
    });
    const delResult = await db.messages.deleteForEveryone(msgToDelete.id, userA.id);
    assert.strictEqual(delResult, true);
    const msgsAfterDelete = await db.messages.list(groupConv.id, userB.id);
    const foundDeleted = msgsAfterDelete.find((m) => m.id === msgToDelete.id);
    assert.strictEqual(foundDeleted?.is_deleted_everyone, true);
    assert.strictEqual(foundDeleted?.text, 'This message was deleted');
    console.log(`  ✓ Delete for Everyone verified: is_deleted_everyone=true, masked text="This message was deleted"`);

    // 9. Clear Chat for user
    console.log('\n[STEP 10] Testing "Clear Chat for User"...');
    await db.conversations.clearChat(directConv.id, userA.id);
    const aliceDirectMsgs = await db.messages.list(directConv.id, userA.id);
    assert.strictEqual(aliceDirectMsgs.length, 0, 'Alice must see 0 messages after Clear Chat');
    const bobDirectMsgs = await db.messages.list(directConv.id, userB.id);
    assert.strictEqual(bobDirectMsgs.length, 1, 'Bob must still see the message');
    console.log(`  ✓ Clear Chat verified: Alice sees 0 messages, Bob sees 1 message`);

    // 10. List user conversations
    console.log('\n[STEP 11] Testing List Conversations for Users...');
    const aliceConvs = await db.conversations.listForUser(userA.id);
    assert.strictEqual(aliceConvs.length, 2, 'Alice must have 2 conversations (1 direct, 1 group)');
    const carolConvs = await db.conversations.listForUser(userC.id);
    assert.strictEqual(carolConvs.length, 1, 'Carol must have 1 conversation (group)');
    console.log(`  ✓ User conversation listings verified: Alice=${aliceConvs.length}, Carol=${carolConvs.length}`);

    console.log('\n================================================================');
    console.log('✅ ALL AURADROP V18 CHAT, GROUP, & MEDIA TESTS PASSED LIVE ON NEON DB');
    console.log('================================================================\n');
  } catch (err: any) {
    console.error('\n❌ V18 INTEGRATION TEST FAILED:', err);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

runV18ProductionTest();
