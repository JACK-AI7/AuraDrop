import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../models/models.dart';
import '../services/native_bridge.dart';
import '../components/glass_components.dart';

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
    setState(() {
      _messages.clear();
      _messages.addAll(msgs);
    });
    _scrollToBottom();
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
      backgroundColor: Colors.transparent,
      body: SafeArea(
        child: Column(
          children: [
            // Header
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.05),
                border: Border(bottom: BorderSide(color: Colors.white.withValues(alpha: 0.1))),
              ),
              child: Row(
                children: [
                  GlassIconButton(
                    icon: Icons.arrow_back_ios_new_rounded,
                    onPressed: () => Navigator.pop(context),
                    size: 36,
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
                          _isPeerTyping ? 'typing...' : 'Offline LAN Connected (${widget.peer.ip})',
                          style: TextStyle(
                            fontSize: 11,
                            color: _isPeerTyping ? widget.accentColor : Colors.white54,
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
                          Icon(Icons.chat_bubble_outline_rounded, size: 48, color: Colors.white.withValues(alpha: 0.2)),
                          const SizedBox(height: 12),
                          const Text(
                            'Offline P2P Conversation',
                            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Colors.white70),
                          ),
                          const SizedBox(height: 4),
                          const Text(
                            'Messages travel directly over the local network.\nZero cloud dependencies.',
                            textAlign: TextAlign.center,
                            style: TextStyle(fontSize: 12, color: Colors.white38),
                          ),
                        ],
                      ),
                    )
                  : ListView.builder(
                      controller: _scrollController,
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      itemCount: _messages.length,
                      itemBuilder: (context, index) {
                        final msg = _messages[index];
                        final isMe = msg.senderId != widget.peer.id;
                        return ChatBubble(
                          message: msg,
                          isMe: isMe,
                          accentColor: widget.accentColor,
                        );
                      },
                    ),
            ),

            // Input Bar
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.05),
                border: Border(top: BorderSide(color: Colors.white.withValues(alpha: 0.1))),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(24),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        color: Colors.white.withValues(alpha: 0.08),
                        child: TextField(
                          controller: _textController,
                          onChanged: _onTextChanged,
                          onSubmitted: (_) => _sendMessage(),
                          style: const TextStyle(color: Colors.white, fontSize: 14),
                          decoration: const InputDecoration(
                            hintText: 'Direct peer message...',
                            hintStyle: TextStyle(color: Colors.white38, fontSize: 14),
                            border: InputBorder.none,
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  GlassIconButton(
                    icon: Icons.send_rounded,
                    onPressed: _sendMessage,
                    color: widget.accentColor,
                    size: 42,
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
