import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../models/models.dart';
import '../services/native_bridge.dart';
import '../components/glass_components.dart';

// ---------------------------------------------------------------------------
// CHAT HUB (MAIN TAB SCREEN)
// ---------------------------------------------------------------------------
class ChatHubScreen extends StatefulWidget {
  final Map<String, PeerDevice> peers;
  final Color accentColor;

  const ChatHubScreen({
    super.key,
    required this.peers,
    required this.accentColor,
  });

  @override
  State<ChatHubScreen> createState() => _ChatHubScreenState();
}

class _ChatHubScreenState extends State<ChatHubScreen> {
  @override
  Widget build(BuildContext context) {
    final peerList = widget.peers.values.toList();

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Direct Peer Chat',
                    style: TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w800,
                      color: Colors.white,
                      letterSpacing: -0.5,
                    ),
                  ),
                  const SizedBox(height: 2),
                  const Text(
                    'Local offline frames (0x30 / 0x31). Zero server mediation.',
                    style: TextStyle(fontSize: 12, color: Color(0xFF8A8A8A)),
                  ),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.white.withValues(alpha: 0.12), width: 0.6),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 6,
                      height: 6,
                      decoration: const BoxDecoration(
                        color: Color(0xFF10B981),
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      '${peerList.length} Active',
                      style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Colors.white),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),

          Expanded(
            child: peerList.isEmpty
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          width: 64,
                          height: 64,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: Colors.white.withValues(alpha: 0.05),
                            border: Border.all(color: Colors.white.withValues(alpha: 0.10), width: 0.7),
                          ),
                          child: const Icon(Icons.chat_bubble_outline_rounded, size: 28, color: Colors.white38),
                        ),
                        const SizedBox(height: 16),
                        const Text(
                          'No Nearby Peers Found',
                          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Colors.white),
                        ),
                        const SizedBox(height: 6),
                        const Text(
                          'Ensure another device running AuraDrop is on\nthe same Wi-Fi or LAN network.',
                          textAlign: TextAlign.center,
                          style: TextStyle(fontSize: 12, color: Color(0xFF8A8A8A), height: 1.4),
                        ),
                      ],
                    ),
                  )
                : ListView.separated(
                    itemCount: peerList.length,
                    separatorBuilder: (context, index) => const SizedBox(height: 10),
                    itemBuilder: (context, index) {
                      final peer = peerList[index];
                      return GlassCard(
                        padding: const EdgeInsets.all(14),
                        onTap: () {
                          Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => ChatScreen(peer: peer, accentColor: widget.accentColor),
                            ),
                          );
                        },
                        child: Row(
                          children: [
                            PeerAvatar(peer: peer, size: 48, accentColor: widget.accentColor),
                            const SizedBox(width: 14),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                    children: [
                                      Text(
                                        peer.name,
                                        style: const TextStyle(
                                          fontWeight: FontWeight.w700,
                                          fontSize: 15,
                                          color: Colors.white,
                                        ),
                                      ),
                                      Text(
                                        peer.ip,
                                        style: const TextStyle(
                                          fontSize: 10,
                                          fontFamily: 'monospace',
                                          color: Color(0xFF8A8A8A),
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    peer.status.isNotEmpty ? peer.status : 'Tap to start direct encrypted offline chat',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontSize: 12, color: Color(0xFF8A8A8A)),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: 8),
                            const Icon(Icons.chevron_right_rounded, color: Colors.white38, size: 20),
                          ],
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// DIRECT CHAT CONVERSATION SCREEN
// ---------------------------------------------------------------------------
class ChatScreen extends StatefulWidget {
  final PeerDevice peer;
  final Color accentColor;

  const ChatScreen({
    super.key,
    required this.peer,
    required this.accentColor,
  });

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final TextEditingController _textController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final List<ChatMessage> _messages = [];

  bool _isPeerTyping = false;
  StreamSubscription? _eventSubscription;
  Timer? _typingTimer;

  @override
  void initState() {
    super.initState();
    _loadMessages();
    _eventSubscription = NativeBridgeService.events.listen(_onEvent);
  }

  @override
  void dispose() {
    _eventSubscription?.cancel();
    _typingTimer?.cancel();
    _textController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _loadMessages() async {
    final msgs = await NativeBridgeService.getChatMessages(widget.peer.id);
    if (mounted) {
      setState(() {
        _messages.clear();
        _messages.addAll(msgs);
      });
      _scrollToBottom();
    }
  }

  void _onEvent(dynamic event) {
    if (event is! Map) return;
    final type = event['type']?.toString();

    if (type == 'chatMessageReceived' || type == 'chatMessageSent') {
      final msg = ChatMessage.fromMap(event);
      if (msg.peerId == widget.peer.id || msg.senderId == widget.peer.id) {
        setState(() {
          _messages.add(msg);
        });
        _scrollToBottom();
      }
    } else if (type == 'chatTypingReceived') {
      final senderId = event['senderId']?.toString();
      if (senderId == widget.peer.id) {
        setState(() {
          _isPeerTyping = event['isTyping'] == true;
        });
      }
    } else if (type == 'chatMessageStatusUpdated') {
      final id = event['id']?.toString();
      final status = event['status']?.toString();
      if (id != null && status != null) {
        setState(() {
          final idx = _messages.indexWhere((m) => m.id == id);
          if (idx != -1) {
            final old = _messages[idx];
            _messages[idx] = ChatMessage(
              id: old.id,
              peerId: old.peerId,
              peerName: old.peerName,
              senderId: old.senderId,
              text: old.text,
              timestamp: old.timestamp,
              status: status,
              messageType: old.messageType,
              fileName: old.fileName,
              fileSize: old.fileSize,
            );
          }
        });
      }
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _sendMessage() async {
    final text = _textController.text.trim();
    if (text.isEmpty) return;
    _textController.clear();
    HapticFeedback.lightImpact();

    await NativeBridgeService.sendChatMessage(
      targetIp: widget.peer.ip,
      peerId: widget.peer.id,
      peerName: widget.peer.name,
      text: text,
    );
  }

  Future<void> _attachFileAndSend() async {
    HapticFeedback.lightImpact();
    final files = await NativeBridgeService.pickFiles();
    if (files.isEmpty) return;

    final file = files.first;
    // Send file payload over high-speed P2P transport
    await NativeBridgeService.sendFiles(
      targetIp: widget.peer.ip,
      targetPort: widget.peer.port,
      files: [file],
    );

    // Send chat message representing the file transfer
    await NativeBridgeService.sendChatMessage(
      targetIp: widget.peer.ip,
      peerId: widget.peer.id,
      peerName: widget.peer.name,
      text: '📎 ${file.name}',
    );
  }

  void _onTextChanged(String text) {
    NativeBridgeService.sendChatTyping(targetIp: widget.peer.ip, isTyping: text.isNotEmpty);
    _typingTimer?.cancel();
    _typingTimer = Timer(const Duration(seconds: 2), () {
      NativeBridgeService.sendChatTyping(targetIp: widget.peer.ip, isTyping: false);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF050505),
      body: SafeArea(
        child: Column(
          children: [
            // Minimal Header
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.03),
                border: Border(bottom: BorderSide(color: Colors.white.withValues(alpha: 0.08), width: 0.7)),
              ),
              child: Row(
                children: [
                  GlassIconButton(
                    icon: Icons.arrow_back_ios_new_rounded,
                    onPressed: () => Navigator.pop(context),
                    size: 38,
                  ),
                  const SizedBox(width: 12),
                  PeerAvatar(peer: widget.peer, size: 40, accentColor: widget.accentColor),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          widget.peer.name,
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15, color: Colors.white),
                        ),
                        Text(
                          _isPeerTyping ? 'typing...' : 'Direct LAN (${widget.peer.ip})',
                          style: TextStyle(
                            fontSize: 11,
                            color: _isPeerTyping ? Colors.white : const Color(0xFF8A8A8A),
                            fontStyle: _isPeerTyping ? FontStyle.italic : FontStyle.normal,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            // Message List
            Expanded(
              child: _messages.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.lock_outline_rounded, size: 40, color: Colors.white.withValues(alpha: 0.2)),
                          const SizedBox(height: 12),
                          const Text(
                            'Direct Peer-to-Peer Encryption',
                            style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Colors.white),
                          ),
                          const SizedBox(height: 4),
                          const Text(
                            'Frames move directly over the local network socket.\nNo internet, accounts, or telemetry.',
                            textAlign: TextAlign.center,
                            style: TextStyle(fontSize: 12, color: Color(0xFF8A8A8A), height: 1.4),
                          ),
                        ],
                      ),
                    )
                  : ListView.builder(
                      controller: _scrollController,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      itemCount: _messages.length,
                      itemBuilder: (context, index) {
                        final msg = _messages[index];
                        final isMe = msg.senderId != widget.peer.id;
                        return ChatBubble(
                          message: msg,
                          isMe: isMe,
                          accentColor: widget.accentColor,
                          onFileTap: () {
                            // File action
                          },
                        );
                      },
                    ),
            ),

            // Input Bar
            Container(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 14),
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: 0.8),
                border: Border(top: BorderSide(color: Colors.white.withValues(alpha: 0.08), width: 0.7)),
              ),
              child: Row(
                children: [
                  GlassIconButton(
                    icon: Icons.attach_file_rounded,
                    onPressed: _attachFileAndSend,
                    size: 40,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(22),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        color: Colors.white.withValues(alpha: 0.06),
                        child: TextField(
                          controller: _textController,
                          onChanged: _onTextChanged,
                          onSubmitted: (_) => _sendMessage(),
                          style: const TextStyle(color: Colors.white, fontSize: 14),
                          decoration: const InputDecoration(
                            hintText: 'Message peer directly...',
                            hintStyle: TextStyle(color: Color(0xFF7E7E7E), fontSize: 13),
                            border: InputBorder.none,
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  GlassIconButton(
                    icon: Icons.send_rounded,
                    onPressed: _sendMessage,
                    color: Colors.white,
                    size: 40,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
