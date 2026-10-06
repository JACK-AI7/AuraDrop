import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../models/models.dart';
import '../services/native_bridge.dart';
import '../theme/aura_theme.dart';
import '../components/minimal_components.dart';

// ---------------------------------------------------------------------------
// CHAT HUB (MAIN TAB SCREEN)
// ---------------------------------------------------------------------------
class ChatHubScreen extends StatefulWidget {
  final Map<String, PeerDevice> peers;

  const ChatHubScreen({
    super.key,
    required this.peers,
  });

  @override
  State<ChatHubScreen> createState() => _ChatHubScreenState();
}

class _ChatHubScreenState extends State<ChatHubScreen> {
  @override
  Widget build(BuildContext context) {
    final theme = AuraTheme.of(context);
    final peerList = widget.peers.values.toList();

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Direct Messages',
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w800,
                  color: theme.textPrimary,
                  letterSpacing: -0.5,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: theme.subtleHighlight,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: theme.border, width: 0.8),
                ),
                child: Text(
                  '${peerList.length} nearby',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: theme.textSecondary,
                  ),
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
                        Text(
                          'No nearby devices',
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                            color: theme.textPrimary,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Devices on the same local network will appear here automatically.',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 12,
                            color: theme.textSecondary,
                            height: 1.4,
                          ),
                        ),
                      ],
                    ),
                  )
                : ListView.separated(
                    itemCount: peerList.length,
                    separatorBuilder: (context, index) => const SizedBox(height: 8),
                    itemBuilder: (context, index) {
                      final peer = peerList[index];
                      return MinimalCard(
                        padding: const EdgeInsets.all(14),
                        onTap: () {
                          Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => ChatScreen(peer: peer),
                            ),
                          );
                        },
                        child: Row(
                          children: [
                            MinimalPeerAvatar(peer: peer, size: 44),
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
                                        style: TextStyle(
                                          fontWeight: FontWeight.w700,
                                          fontSize: 15,
                                          color: theme.textPrimary,
                                        ),
                                      ),
                                      Text(
                                        peer.ip,
                                        style: TextStyle(
                                          fontSize: 11,
                                          fontFamily: 'monospace',
                                          color: theme.textSecondary,
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 3),
                                  Text(
                                    peer.status.isNotEmpty ? peer.status : 'Direct offline encrypted chat',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      fontSize: 12,
                                      color: theme.textSecondary,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: 8),
                            Icon(
                              Icons.chevron_right_rounded,
                              color: theme.textSecondary,
                              size: 18,
                            ),
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

  const ChatScreen({
    super.key,
    required this.peer,
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
          duration: const Duration(milliseconds: 250),
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
      text: file.name,
    );
  }

  void _onTextChanged(String text) {
    NativeBridgeService.sendChatTyping(targetIp: widget.peer.ip, isTyping: text.isNotEmpty);
    _typingTimer?.cancel();
    _typingTimer = Timer(const Duration(seconds: 2), () {
      NativeBridgeService.sendChatTyping(targetIp: widget.peer.ip, isTyping: false);
    });
  }

  String _formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    if (bytes < 1024 * 1024 * 1024) return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(2)} GB';
  }

  @override
  Widget build(BuildContext context) {
    final theme = AuraTheme.of(context);

    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: theme.background,
        elevation: 0,
        scrolledUnderElevation: 0,
        leading: IconButton(
          icon: Icon(Icons.arrow_back_ios_new_rounded, color: theme.textPrimary, size: 18),
          onPressed: () => Navigator.pop(context),
        ),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              widget.peer.name,
              style: TextStyle(
                fontWeight: FontWeight.w700,
                fontSize: 16,
                color: theme.textPrimary,
              ),
            ),
            Text(
              _isPeerTyping ? 'typing...' : widget.peer.ip,
              style: TextStyle(
                fontSize: 11,
                color: _isPeerTyping ? theme.textPrimary : theme.textSecondary,
                fontStyle: _isPeerTyping ? FontStyle.italic : FontStyle.normal,
              ),
            ),
          ],
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1.0),
          child: Container(color: theme.border, height: 1.0),
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            // Message List
            Expanded(
              child: _messages.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            'Direct Peer-to-Peer Encryption',
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                              color: theme.textPrimary,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'Frames move directly over the local network socket.\nZero cloud dependencies.',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 12,
                              color: theme.textSecondary,
                              height: 1.4,
                            ),
                          ),
                        ],
                      ),
                    )
                  : ListView.builder(
                      controller: _scrollController,
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                      itemCount: _messages.length,
                      itemBuilder: (context, index) {
                        final msg = _messages[index];
                        final isMe = msg.senderId != widget.peer.id;
                        final isFile = msg.messageType == 'file' || msg.text.startsWith('📎');

                        return Align(
                          alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
                          child: Container(
                            margin: const EdgeInsets.symmetric(vertical: 4),
                            constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.76),
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                            decoration: BoxDecoration(
                              color: isMe ? theme.actionBackground : theme.cardBackground,
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(
                                color: isMe ? theme.actionBackground : theme.border,
                                width: 1.0,
                              ),
                            ),
                            child: Column(
                              crossAxisAlignment: isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
                              children: [
                                if (isFile) ...[
                                  Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Icon(
                                        Icons.attach_file_rounded,
                                        size: 16,
                                        color: isMe ? theme.actionText : theme.textPrimary,
                                      ),
                                      const SizedBox(width: 6),
                                      Flexible(
                                        child: Text(
                                          msg.fileName ?? msg.text.replaceAll('📎 ', ''),
                                          style: TextStyle(
                                            fontSize: 13,
                                            fontWeight: FontWeight.w700,
                                            color: isMe ? theme.actionText : theme.textPrimary,
                                          ),
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ),
                                    ],
                                  ),
                                  if (msg.fileSize != null) ...[
                                    const SizedBox(height: 2),
                                    Text(
                                      _formatBytes(msg.fileSize!),
                                      style: TextStyle(
                                        fontSize: 11,
                                        color: isMe ? theme.actionText.withValues(alpha: 0.7) : theme.textSecondary,
                                      ),
                                    ),
                                  ],
                                ] else ...[
                                  Text(
                                    msg.text,
                                    style: TextStyle(
                                      fontSize: 14,
                                      color: isMe ? theme.actionText : theme.textPrimary,
                                      height: 1.35,
                                    ),
                                  ),
                                ],
                                const SizedBox(height: 3),
                                Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Text(
                                      '${msg.timestamp.hour.toString().padLeft(2, '0')}:${msg.timestamp.minute.toString().padLeft(2, '0')}',
                                      style: TextStyle(
                                        fontSize: 10,
                                        color: isMe ? theme.actionText.withValues(alpha: 0.6) : theme.textSecondary,
                                      ),
                                    ),
                                    if (isMe) ...[
                                      const SizedBox(width: 4),
                                      Icon(
                                        msg.status == 'read'
                                            ? Icons.done_all
                                            : msg.status == 'delivered'
                                                ? Icons.done_all
                                                : msg.status == 'sent'
                                                    ? Icons.done
                                                    : Icons.schedule,
                                        size: 12,
                                        color: isMe ? theme.actionText.withValues(alpha: 0.7) : theme.textSecondary,
                                      ),
                                    ],
                                  ],
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
            ),

            // Input Bar
            Container(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 10),
              decoration: BoxDecoration(
                color: theme.background,
                border: Border(top: BorderSide(color: theme.border, width: 1.0)),
              ),
              child: Row(
                children: [
                  MinimalIconButton(
                    icon: Icons.attach_file_rounded,
                    onPressed: _attachFileAndSend,
                    size: 38,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14),
                      decoration: BoxDecoration(
                        color: theme.cardBackground,
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: theme.border, width: 1.0),
                      ),
                      child: TextField(
                        controller: _textController,
                        onChanged: _onTextChanged,
                        onSubmitted: (_) => _sendMessage(),
                        style: TextStyle(color: theme.textPrimary, fontSize: 14),
                        decoration: InputDecoration(
                          hintText: 'Message...',
                          hintStyle: TextStyle(color: theme.textSecondary, fontSize: 14),
                          border: InputBorder.none,
                          isDense: true,
                          contentPadding: const EdgeInsets.symmetric(vertical: 10),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  MinimalIconButton(
                    icon: Icons.arrow_upward_rounded,
                    onPressed: _sendMessage,
                    size: 38,
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
