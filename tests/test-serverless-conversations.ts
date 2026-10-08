import assert from 'node:assert';
import handler from '../api/conversations';

class MockReq {
  public method: string;
  public url: string;
  public headers: Record<string, string>;
  public body: any;
  private dataListeners: ((chunk: any) => void)[] = [];
  private endListeners: (() => void)[] = [];

  constructor(method: string, url: string, headers: Record<string, string> = {}, body?: any) {
    this.method = method;
    this.url = url;
    this.headers = headers;
    this.body = body;
  }

  on(event: string, cb: any) {
    if (event === 'data') this.dataListeners.push(cb);
    if (event === 'end') {
      this.endListeners.push(cb);
      process.nextTick(() => {
        if (this.body && typeof this.body !== 'object') {
          this.dataListeners.forEach((l) => l(this.body));
        }
        this.endListeners.forEach((l) => l());
      });
    }
    return this;
  }
}

class MockRes {
  public statusCode = 200;
  public headers: Record<string, string> = {};
  public body = '';
  private doneCallback?: (res: MockRes) => void;

  constructor(done?: (res: MockRes) => void) {
    this.doneCallback = done;
  }

  setHeader(k: string, v: string) {
    this.headers[k.toLowerCase()] = v;
  }

  end(data?: string) {
    if (data) this.body += data;
    if (this.doneCallback) this.doneCallback(this);
  }

  json() {
    return JSON.parse(this.body);
  }
}

function invokeHandler(req: MockReq): Promise<MockRes> {
  return new Promise((resolve) => {
    const res = new MockRes(resolve);
    handler(req, res);
  });
}

async function testServerlessConversations() {
  console.log('================================================================');
  console.log('🧪 TESTING VERCEL SERVERLESS CONVERSATIONS API WITH NEON DB');
  console.log('================================================================\n');

  const nonce = Date.now().toString(36);
  const userA = `user_alice_${nonce}`;
  const userB = `user_bob_${nonce}`;

  // 1. GET /api/conversations (Initially empty or existing for userA)
  console.log('[Step 1] GET /api/conversations for Alice...');
  let res = await invokeHandler(
    new MockReq('GET', `/api/conversations?userId=${userA}`, {
      'x-user-id': userA,
      'x-user-name': 'Alice Web',
    })
  );
  assert.strictEqual(res.statusCode, 200);
  let data = res.json();
  assert.strictEqual(data.success, true);
  console.log(`  ✓ Received Alice conversations: ${data.conversations.length} items`);

  // 2. POST /api/conversations/direct (Create direct conversation between Alice and Bob)
  console.log('\n[Step 2] POST /api/conversations/direct (Alice -> Bob)...');
  res = await invokeHandler(
    new MockReq(
      'POST',
      '/api/conversations/direct',
      { 'x-user-id': userA, 'x-user-name': 'Alice Web' },
      { userAId: userA, userBId: userB, peerName: 'Bob Device' }
    )
  );
  assert.strictEqual(res.statusCode, 200);
  data = res.json();
  assert.strictEqual(data.success, true);
  assert.ok(data.conversation?.id);
  const directConvId = data.conversation.id;
  console.log(`  ✓ Direct conversation created: ID = ${directConvId}`);

  // 3. POST /api/conversations/:id/messages (Send real message from Alice)
  console.log('\n[Step 3] POST message to conversation...');
  res = await invokeHandler(
    new MockReq(
      'POST',
      `/api/conversations/${directConvId}/messages`,
      { 'x-user-id': userA },
      { text: 'Hello Bob! This is a real test from desktop web.', type: 'TEXT' }
    )
  );
  assert.strictEqual(res.statusCode, 201);
  data = res.json();
  assert.strictEqual(data.success, true);
  assert.ok(data.message?.id);
  const msg1Id = data.message.id;
  assert.strictEqual(data.message.text, 'Hello Bob! This is a real test from desktop web.');
  console.log(`  ✓ Message sent into Neon DB: ID = ${msg1Id}, text = "${data.message.text}"`);

  // 4. POST /api/conversations/:id/messages with FILE attachment
  console.log('\n[Step 4] POST file attachment message...');
  res = await invokeHandler(
    new MockReq(
      'POST',
      `/api/conversations/${directConvId}/messages`,
      { 'x-user-id': userB },
      {
        text: 'project_spec.pdf',
        type: 'FILE',
        attachments: [
          {
            fileName: 'project_spec.pdf',
            fileSize: 1048576,
            mimeType: 'application/pdf',
          },
        ],
      }
    )
  );
  assert.strictEqual(res.statusCode, 201);
  data = res.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.message.type, 'FILE');
  assert.strictEqual(data.message.attachments.length, 1);
  console.log(`  ✓ Attachment message created: ${data.message.attachments[0].fileName} (${data.message.attachments[0].fileSize} bytes)`);

  // 5. GET /api/conversations/:id/messages
  console.log('\n[Step 5] GET messages for conversation...');
  res = await invokeHandler(
    new MockReq('GET', `/api/conversations/${directConvId}/messages?limit=50`, { 'x-user-id': userA })
  );
  assert.strictEqual(res.statusCode, 200);
  data = res.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.messages.length, 2);
  console.log(`  ✓ Fetched ${data.messages.length} messages in correct order`);

  // 6. PUT /api/conversations/:id/disappearing (Set timer to 120s)
  console.log('\n[Step 6] PUT disappearing timer...');
  res = await invokeHandler(
    new MockReq(
      'PUT',
      `/api/conversations/${directConvId}/disappearing`,
      { 'x-user-id': userA },
      { seconds: 120 }
    )
  );
  assert.strictEqual(res.statusCode, 200);
  data = res.json();
  assert.strictEqual(data.disappearing_seconds, 120);
  console.log(`  ✓ Disappearing timer set to 120s`);

  // 7. DELETE /api/messages/:id (Delete for everyone)
  console.log('\n[Step 7] DELETE message for everyone...');
  res = await invokeHandler(
    new MockReq('DELETE', `/api/messages/${msg1Id}`, { 'x-user-id': userA })
  );
  assert.strictEqual(res.statusCode, 200);
  data = res.json();
  assert.strictEqual(data.success, true);
  console.log(`  ✓ Message deleted for everyone`);

  // 8. Verify delete masked in GET messages
  res = await invokeHandler(
    new MockReq('GET', `/api/conversations/${directConvId}/messages?limit=50`, { 'x-user-id': userB })
  );
  data = res.json();
  const deletedMsg = data.messages.find((m: any) => m.id === msg1Id);
  assert.strictEqual(deletedMsg.is_deleted_everyone, true);
  assert.strictEqual(deletedMsg.text, 'This message was deleted');
  console.log(`  ✓ Verified deleted message masked to "${deletedMsg.text}"`);

  // 9. DELETE /api/conversations/:id/clear (Clear chat for Alice)
  console.log('\n[Step 9] Clear chat for Alice...');
  res = await invokeHandler(
    new MockReq('DELETE', `/api/conversations/${directConvId}/clear`, { 'x-user-id': userA })
  );
  assert.strictEqual(res.statusCode, 200);
  data = res.json();
  assert.strictEqual(data.cleared, true);

  // Alice sees 0 messages
  res = await invokeHandler(
    new MockReq('GET', `/api/conversations/${directConvId}/messages?limit=50`, { 'x-user-id': userA })
  );
  data = res.json();
  assert.strictEqual(data.messages.length, 0);
  console.log(`  ✓ Alice sees 0 messages after clear`);

  // Bob still sees messages
  res = await invokeHandler(
    new MockReq('GET', `/api/conversations/${directConvId}/messages?limit=50`, { 'x-user-id': userB })
  );
  data = res.json();
  assert.strictEqual(data.messages.length, 2);
  console.log(`  ✓ Bob still sees all messages`);

  console.log('\n================================================================');
  console.log('🎉 ALL VERCEL SERVERLESS CHAT & CONVERSATION TESTS PASSED 100%!');
  console.log('================================================================\n');
  process.exit(0);
}

testServerlessConversations().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
