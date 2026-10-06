import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'models/models.dart';
import 'theme/glass_theme.dart';
import 'components/glass_components.dart';
import 'services/native_bridge.dart';
import 'screens/chat_screen.dart';
import 'screens/history_screen.dart';
import 'screens/profile_screen.dart';
import 'screens/settings_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Color(0xFF0C0E14),
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );
  runApp(const AuraDropApp());
}

class AuraDropApp extends StatefulWidget {
  const AuraDropApp({super.key});

  @override
  State<AuraDropApp> createState() => _AuraDropAppState();
}

class _AuraDropAppState extends State<AuraDropApp> {
  String _themeKey = 'glass_dark';
  String _accentKey = 'cyan';

  void updateTheme(String themeKey, String accentKey) {
    setState(() {
      _themeKey = themeKey;
      _accentKey = accentKey;
    });
  }

  @override
  Widget build(BuildContext context) {
    final themeData = GlassTheme.getTheme(_themeKey);
    final accentColor = GlassTheme.getAccent(_accentKey);

    return MaterialApp(
      title: 'AuraDrop',
      debugShowCheckedModeBanner: false,
      themeMode: ThemeMode.dark,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: themeData.background,
        primaryColor: accentColor,
        colorScheme: ColorScheme.dark(
          primary: accentColor,
          surface: themeData.background,
        ),
        fontFamily: 'Roboto',
      ),
      home: AuraDropHomeScreen(
        themeData: themeData,
        accentColor: accentColor,
        onProfileUpdated: (key, val) {
          if (key == 'theme') setState(() => _themeKey = val);
          if (key == 'accent') setState(() => _accentKey = val);
        },
      ),
    );
  }
}

class AuraDropHomeScreen extends StatefulWidget {
  final GlassThemeData themeData;
  final Color accentColor;
  final Function(String, String) onProfileUpdated;

  const AuraDropHomeScreen({
    super.key,
    required this.themeData,
    required this.accentColor,
    required this.onProfileUpdated,
  });

  @override
  State<AuraDropHomeScreen> createState() => _AuraDropHomeScreenState();
}

class _AuraDropHomeScreenState extends State<AuraDropHomeScreen>
    with TickerProviderStateMixin, WidgetsBindingObserver {
  // Navigation
  int _currentTabIndex = 0; // 0: Radar, 1: Tray, 2: History, 3: Profile, 4: Settings

  // Subscriptions & Timers
  StreamSubscription? _eventSubscription;
  Timer? _temporaryVisibilityTimer;
  int _temporarySecondsRemaining = 600;

  // Local Device Identity & Profile
  String _deviceId = 'android_local';
  String _deviceName = 'My Device';
  String _localIp = '127.0.0.1';
  UserProfile _userProfile = UserProfile(
    displayName: 'AuraDrop User',
    avatarIndex: 0,
    bio: 'Nearby sharing made effortless',
    theme: 'glass_dark',
    accent: 'cyan',
    visibility: 'everyone',
  );

  // Visibility & Discovery
  VisibilityMode _visibilityMode = VisibilityMode.everyoneNearby;
  bool _isDiscovering = false;

  // Discovered Peers
  final Map<String, PeerDevice> _peers = {};
  final Set<String> _trustedPeerIds = {};

  // Selected Files Tray
  final List<PickedFileMeta> _selectedFiles = [];

  // Active Transfer State Machine
  TransferState _transferState = TransferState.idle;
  bool _isSender = false;
  String _activeTransferId = '';
  PeerDevice? _activePeer;
  String _activeFileName = '';
  int _transferredBytes = 0;
  int _totalTransferBytes = 1;
  int _speedBytesPerSec = 0;
  int _etaSeconds = 0;
  String _lastSavedPath = '';

  // Animations
  late AnimationController _radarController;
  late AnimationController _pulseController;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);

    _radarController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 5),
    )..repeat();

    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2200),
    )..repeat(reverse: true);

    _initApp();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _temporaryVisibilityTimer?.cancel();
    _radarController.dispose();
    _pulseController.dispose();
    _eventSubscription?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _checkSystemShare();
    }
  }

  Future<void> _initApp() async {
    try {
      await NativeBridgeService.requestPermissions();
      final info = await NativeBridgeService.getDeviceInfo();
      final prof = await NativeBridgeService.getUserProfile();
      final trusted = await NativeBridgeService.getTrustedPeers();

      setState(() {
        _deviceId = info['deviceId']?.toString() ?? _deviceId;
        _deviceName = prof.displayName.isNotEmpty ? prof.displayName : (info['deviceName']?.toString() ?? _deviceName);
        _localIp = info['ipAddress']?.toString() ?? _localIp;
        _userProfile = prof;
        for (final t in trusted) {
          final pid = t['peerId']?.toString();
          if (pid != null) _trustedPeerIds.add(pid);
        }
      });

      await NativeBridgeService.startTransferServer();
      _eventSubscription = NativeBridgeService.events.listen(_onNativeEvent);
      _applyVisibilityMode(_visibilityMode);
      _checkSystemShare();
    } catch (e) {
      debugPrint('Initialization error: $e');
    }
  }

  Future<void> _checkSystemShare() async {
    final files = await NativeBridgeService.getInitialShareFiles();
    if (files.isNotEmpty) {
      setState(() {
        _selectedFiles.addAll(files);
        _currentTabIndex = 0;
      });
      _showSnackBar('${files.length} file(s) received from share sheet', isSuccess: true);
    }
  }

  void _onNativeEvent(dynamic event) {
    if (event is! Map) return;
    final type = event['type']?.toString();

    switch (type) {
      case 'systemShareReceived':
        final files = event['files'];
        if (files is List) {
          setState(() {
            for (final f in files) {
              if (f is Map) _selectedFiles.add(PickedFileMeta.fromMap(f));
            }
          });
          _showSnackBar('${_selectedFiles.length} file(s) ready to share', isSuccess: true);
        }
        break;

      case 'peerDiscovered':
        final peerData = event['peer'];
        if (peerData is Map) {
          final id = peerData['id']?.toString() ?? '';
          if (_visibilityMode == VisibilityMode.receivingOff) return;
          final isTrusted = _trustedPeerIds.contains(id);
          if (_visibilityMode == VisibilityMode.contactsOnly && !isTrusted) return;

          final peer = PeerDevice.fromMap(peerData, isTrusted: isTrusted);
          setState(() {
            _peers[peer.id] = peer;
          });
        }
        break;

      case 'dataChannelState':
        final st = event['state']?.toString();
        setState(() {
          if (st == 'DATA_CHANNEL_CONNECTING') _transferState = TransferState.connecting;
          if (st == 'READY_TO_TRANSFER') _transferState = TransferState.preparing;
        });
        break;

      case 'transferRequest':
        HapticFeedback.heavyImpact();
        setState(() => _transferState = TransferState.waitingForAccept);
        _showIncomingTransferModal(event);
        break;

      case 'transferProgress':
        final st = event['state']?.toString();
        final xferBytes = (event['transferredBytes'] as num?)?.toInt() ?? _transferredBytes;
        final totBytes = (event['totalBytes'] as num?)?.toInt() ?? _totalTransferBytes;
        final speed = (event['speedBytesPerSec'] as num?)?.toInt() ?? _speedBytesPerSec;
        final eta = (event['etaSeconds'] as num?)?.toInt() ?? _etaSeconds;
        final fName = event['fileName']?.toString() ?? _activeFileName;

        setState(() {
          _transferredBytes = xferBytes;
          _totalTransferBytes = math.max(1, totBytes);
          _speedBytesPerSec = speed;
          _etaSeconds = eta;
          if (fName.isNotEmpty) _activeFileName = fName;

          if (st == 'VERIFYING') {
            _transferState = TransferState.verifying;
          } else if (st == 'TRANSFERRING') {
            _transferState = TransferState.transferring;
          }
        });
        break;

      case 'transferCompleted':
        HapticFeedback.mediumImpact();
        final path = event['savedPath']?.toString() ?? '';
        final finalFileName = event['fileName']?.toString() ?? _activeFileName;
        final finalTotal = (event['totalBytes'] as num?)?.toInt() ?? _totalTransferBytes;

        setState(() {
          _transferState = TransferState.completed;
          _lastSavedPath = path;
          _transferredBytes = finalTotal;

          if (_activePeer != null) {
            _trustedPeerIds.add(_activePeer!.id);
            NativeBridgeService.setPeerTrusted(_activePeer!.id, _activePeer!.name, true);
          }
        });
        _showSnackBar('$finalFileName transferred & verified successfully!', isSuccess: true);
        break;

      case 'transferError':
        HapticFeedback.vibrate();
        final err = event['error']?.toString() ?? 'Transfer failed';
        setState(() => _transferState = TransferState.failed);
        _showSnackBar(err, isSuccess: false);
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // VISIBILITY CONTROLS
  // ---------------------------------------------------------------------------
  Future<void> _applyVisibilityMode(VisibilityMode mode) async {
    _temporaryVisibilityTimer?.cancel();
    setState(() => _visibilityMode = mode);

    if (mode == VisibilityMode.receivingOff) {
      await NativeBridgeService.stopDiscovery();
      setState(() {
        _isDiscovering = false;
        _peers.clear();
      });
    } else {
      await NativeBridgeService.startDiscovery();
      setState(() => _isDiscovering = true);

      if (mode == VisibilityMode.temporaryEveryone) {
        _temporarySecondsRemaining = 600;
        _temporaryVisibilityTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
          if (_temporarySecondsRemaining <= 1) {
            timer.cancel();
            _applyVisibilityMode(VisibilityMode.contactsOnly);
            _showSnackBar('10 minutes temporary visibility ended', isSuccess: true);
          } else {
            setState(() => _temporarySecondsRemaining--);
          }
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // FILE ACTIONS & SEND
  // ---------------------------------------------------------------------------
  Future<void> _pickFiles() async {
    HapticFeedback.lightImpact();
    final files = await NativeBridgeService.pickFiles();
    if (files.isNotEmpty) {
      setState(() => _selectedFiles.addAll(files));
      _showSnackBar('${files.length} file(s) added to tray', isSuccess: true);
    }
  }

  Future<void> _sendFilesToPeer(PeerDevice peer) async {
    if (_selectedFiles.isEmpty) {
      _showSnackBar('Select files before picking a recipient.', isSuccess: false);
      _pickFiles();
      return;
    }

    HapticFeedback.mediumImpact();
    final totalSize = _selectedFiles.fold(0, (acc, f) => acc + f.size);

    setState(() {
      _activePeer = peer;
      _isSender = true;
      _activeTransferId = 'send_${DateTime.now().millisecondsSinceEpoch}';
      _activeFileName = _selectedFiles.length == 1 ? _selectedFiles.first.name : '${_selectedFiles.length} files';
      _transferredBytes = 0;
      _totalTransferBytes = math.max(1, totalSize);
      _speedBytesPerSec = 0;
      _etaSeconds = 0;
      _transferState = TransferState.peerFound;
    });

    try {
      await NativeBridgeService.sendFiles(
        targetIp: peer.ip,
        targetPort: peer.port,
        files: _selectedFiles,
      );
    } catch (e) {
      setState(() => _transferState = TransferState.failed);
      _showSnackBar('Connection failed: $e', isSuccess: false);
    }
  }

  Future<void> _cancelTransfer() async {
    HapticFeedback.selectionClick();
    await NativeBridgeService.cancelTransfer(_activeTransferId);
    setState(() => _transferState = TransferState.idle);
  }

  void _showIncomingTransferModal(Map<dynamic, dynamic> req) {
    final transferId = req['transferId']?.toString() ?? '';
    final senderName = req['senderName']?.toString() ?? 'Nearby Peer';
    final totalFiles = req['totalFiles']?.toString() ?? '1';
    final totalBytes = (req['totalBytes'] as num?)?.toInt() ?? 0;
    final sas = req['sas']?.toString() ?? '4829 1049 8812 3726';

    showModalBottomSheet(
      context: context,
      isDismissible: false,
      enableDrag: false,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return Container(
          margin: const EdgeInsets.all(16),
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: const Color(0xFF14161F),
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: Colors.white.withValues(alpha: 0.15)),
            boxShadow: const [BoxShadow(color: Colors.black87, blurRadius: 30, offset: Offset(0, 10))],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(width: 36, height: 4, decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(2))),
              const SizedBox(height: 20),
              Container(
                width: 60,
                height: 60,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: Colors.white.withValues(alpha: 0.1),
                  border: Border.all(color: widget.accentColor, width: 1.5),
                ),
                child: Center(
                  child: Text(
                    senderName.isNotEmpty ? senderName.substring(0, 1).toUpperCase() : '?',
                    style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: widget.accentColor),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Text(
                senderName,
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Colors.white),
              ),
              const SizedBox(height: 4),
              Text(
                'wants to send $totalFiles file(s) • ${_formatBytes(totalBytes)}',
                style: const TextStyle(fontSize: 13, color: Colors.white60),
              ),
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.05),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
                ),
                child: Text(
                  'SAS CODE: $sas',
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.2, color: widget.accentColor),
                ),
              ),
              const SizedBox(height: 24),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        side: const BorderSide(color: Color(0xFFF87171)),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      ),
                      onPressed: () async {
                        Navigator.pop(ctx);
                        await NativeBridgeService.declineTransfer(transferId);
                        setState(() => _transferState = TransferState.idle);
                      },
                      child: const Text('Decline', style: TextStyle(color: Color(0xFFF87171), fontWeight: FontWeight.w700)),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: widget.accentColor,
                        foregroundColor: const Color(0xFF0C0E14),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                        elevation: 0,
                      ),
                      onPressed: () async {
                        Navigator.pop(ctx);
                        HapticFeedback.mediumImpact();
                        setState(() {
                          _transferState = TransferState.transferring;
                          _isSender = false;
                          _activeTransferId = transferId;
                          _activeFileName = '$totalFiles files';
                          _totalTransferBytes = math.max(1, totalBytes);
                          _transferredBytes = 0;
                          _activePeer = PeerDevice(
                            id: 'sender',
                            name: senderName,
                            platform: 'android',
                            ip: '127.0.0.1',
                            port: 48291,
                            lastSeen: DateTime.now(),
                          );
                        });
                        await NativeBridgeService.acceptTransfer(transferId);
                      },
                      child: const Text('Accept', style: TextStyle(fontWeight: FontWeight.w800)),
                    ),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  void _showSnackBar(String text, {required bool isSuccess}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(text, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
        backgroundColor: isSuccess ? const Color(0xFF10B981) : const Color(0xFFF87171),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }

  String _formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    if (bytes < 1024 * 1024 * 1024) return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(2)} GB';
  }

  String _formatSpeed(int bytesPerSec) {
    return '${_formatBytes(bytesPerSec)}/s';
  }

  // ---------------------------------------------------------------------------
  // MAIN BUILD
  // ---------------------------------------------------------------------------
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Stack(
          children: [
            // Background Radial Orbs
            Positioned(
              top: -60,
              right: -60,
              child: Container(
                width: 240,
                height: 240,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: widget.accentColor.withValues(alpha: 0.08),
                  boxShadow: [
                    BoxShadow(color: widget.accentColor.withValues(alpha: 0.12), blurRadius: 100, spreadRadius: 20),
                  ],
                ),
              ),
            ),

            Column(
              children: [
                _buildHeader(),
                Expanded(
                  child: IndexedStack(
                    index: _currentTabIndex,
                    children: [
                      _buildRadarScreen(),
                      _buildTrayScreen(),
                      HistoryScreen(accentColor: widget.accentColor),
                      ProfileScreen(
                        profile: _userProfile,
                        onProfileUpdated: (key, val) {
                          widget.onProfileUpdated(key, val);
                          if (key == 'display_name') setState(() => _deviceName = val);
                        },
                      ),
                      SettingsScreen(
                        currentVisibility: _visibilityMode,
                        onVisibilityChanged: _applyVisibilityMode,
                        temporarySecondsRemaining: _temporarySecondsRemaining,
                        accentColor: widget.accentColor,
                      ),
                    ],
                  ),
                ),
                _buildGlassBottomNav(),
              ],
            ),

            // Active Transfer Modal Overlay
            if (_transferState != TransferState.idle &&
                _transferState != TransferState.discovering &&
                _transferState != TransferState.waitingForAccept)
              _buildTransferProgressHUD(),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    String visText = 'Everyone';
    if (_visibilityMode == VisibilityMode.receivingOff) visText = 'Off';
    if (_visibilityMode == VisibilityMode.contactsOnly) visText = 'Contacts';
    if (_visibilityMode == VisibilityMode.temporaryEveryone) {
      visText = '${_temporarySecondsRemaining ~/ 60}:${(_temporarySecondsRemaining % 60).toString().padLeft(2, '0')}';
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.04),
        border: Border(bottom: BorderSide(color: Colors.white.withValues(alpha: 0.08))),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: widget.accentColor.withValues(alpha: 0.2),
                  border: Border.all(color: widget.accentColor.withValues(alpha: 0.4)),
                ),
                child: Center(
                  child: Icon(Icons.near_me_rounded, color: widget.accentColor, size: 18),
                ),
              ),
              const SizedBox(width: 10),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('AuraDrop V3', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Colors.white)),
                  Text('$_deviceName • $_localIp', style: const TextStyle(fontSize: 11, color: Colors.white54)),
                ],
              ),
            ],
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: Colors.white.withValues(alpha: 0.12)),
            ),
            child: Row(
              children: [
                Container(
                  width: 6,
                  height: 6,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: _visibilityMode != VisibilityMode.receivingOff ? widget.accentColor : Colors.white38,
                  ),
                ),
                const SizedBox(width: 6),
                Text(
                  visText,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: _visibilityMode != VisibilityMode.receivingOff ? widget.accentColor : Colors.white54,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // RADAR & DISCOVERY SCREEN
  // ---------------------------------------------------------------------------
  Widget _buildRadarScreen() {
    final peerList = _peers.values.toList();
    peerList.sort((a, b) {
      if (a.isTrusted && !b.isTrusted) return -1;
      if (!a.isTrusted && b.isTrusted) return 1;
      return a.name.compareTo(b.name);
    });

    return LayoutBuilder(
      builder: (context, constraints) {
        final center = Offset(constraints.maxWidth / 2, constraints.maxHeight * 0.42);
        final maxRadius = math.min(constraints.maxWidth, constraints.maxHeight) * 0.40;

        return Stack(
          children: [
            CustomPaint(
              size: Size(constraints.maxWidth, constraints.maxHeight),
              painter: GlassDiscoveryRadarPainter(
                angle: _radarController.value * 2 * math.pi,
                pulseFactor: _pulseController.value,
                accentColor: widget.accentColor,
                isScanning: _isDiscovering && _transferState == TransferState.idle,
              ),
            ),

            // Center Orb
            Positioned(
              left: center.dx - 42,
              top: center.dy - 42,
              child: AuraOrb(
                pulseFactor: _pulseController.value,
                accentColor: widget.accentColor,
                isScanning: _isDiscovering,
                onTap: _pickFiles,
              ),
            ),

            // Discovered Peers positioned in orbit
            for (int i = 0; i < peerList.length; i++)
              _buildOrbitPeerCard(peerList[i], i, peerList.length, center, maxRadius),

            // Floating Share Tray
            Positioned(
              left: 16,
              right: 16,
              bottom: 16,
              child: _buildFloatingShareTray(),
            ),
          ],
        );
      },
    );
  }

  Widget _buildOrbitPeerCard(PeerDevice peer, int index, int total, Offset center, double radius) {
    final double step = (2 * math.pi) / total;
    final double angle = index * step - (math.pi / 2);
    final double nodeRadius = radius * (0.70 + (index % 2) * 0.22);
    final double dx = center.dx + nodeRadius * math.cos(angle) - 34;
    final double dy = center.dy + nodeRadius * math.sin(angle) - 34;

    return Positioned(
      left: dx,
      top: dy,
      child: GestureDetector(
        onTap: () => _sendFilesToPeer(peer),
        onLongPress: () {
          // Open offline P2P chat on long press!
          HapticFeedback.mediumImpact();
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => ChatScreen(peer: peer, accentColor: widget.accentColor),
            ),
          );
        },
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            PeerAvatar(peer: peer, size: 62, accentColor: widget.accentColor),
            const SizedBox(height: 6),
            Container(
              constraints: const BoxConstraints(maxWidth: 80),
              child: Text(
                peer.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Colors.white),
              ),
            ),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                GestureDetector(
                  onTap: () {
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => ChatScreen(peer: peer, accentColor: widget.accentColor),
                      ),
                    );
                  },
                  child: Container(
                    margin: const EdgeInsets.only(top: 2),
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                    decoration: BoxDecoration(
                      color: widget.accentColor.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.chat_bubble_outline, size: 9, color: widget.accentColor),
                        const SizedBox(width: 3),
                        Text('Chat', style: TextStyle(fontSize: 8, fontWeight: FontWeight.bold, color: widget.accentColor)),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFloatingShareTray() {
    final count = _selectedFiles.length;
    final totalSize = _selectedFiles.fold(0, (acc, f) => acc + f.size);

    return GlassCard(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: widget.accentColor.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(Icons.attachment_rounded, color: widget.accentColor, size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  count > 0 ? '$count file(s) selected' : 'Ready to share',
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Colors.white),
                ),
                Text(
                  count > 0 ? _formatBytes(totalSize) : 'Tap "+ Add" to pick files or send',
                  style: const TextStyle(fontSize: 11, color: Colors.white54),
                ),
              ],
            ),
          ),
          GlassButton(
            text: 'Add',
            icon: Icons.add,
            accentColor: widget.accentColor,
            onPressed: _pickFiles,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // FILES TRAY SCREEN
  // ---------------------------------------------------------------------------
  Widget _buildTrayScreen() {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('File Tray', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Colors.white)),
                  Text('${_selectedFiles.length} file(s) queued', style: const TextStyle(fontSize: 12, color: Colors.white54)),
                ],
              ),
              Row(
                children: [
                  if (_selectedFiles.isNotEmpty)
                    IconButton(
                      icon: const Icon(Icons.delete_outline, color: Color(0xFFF87171)),
                      onPressed: () => setState(() => _selectedFiles.clear()),
                    ),
                  GlassButton(
                    text: 'Add Files',
                    icon: Icons.add,
                    accentColor: widget.accentColor,
                    onPressed: _pickFiles,
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 16),
          Expanded(
            child: _selectedFiles.isEmpty
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.layers_clear_outlined, size: 48, color: Colors.white.withValues(alpha: 0.2)),
                        const SizedBox(height: 12),
                        const Text('Your tray is empty', style: TextStyle(fontSize: 15, color: Colors.white60)),
                      ],
                    ),
                  )
                : ListView.separated(
                    itemCount: _selectedFiles.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 8),
                    itemBuilder: (context, idx) {
                      final f = _selectedFiles[idx];
                      return GlassCard(
                        padding: const EdgeInsets.all(12),
                        child: Row(
                          children: [
                            Container(
                              width: 40,
                              height: 40,
                              decoration: BoxDecoration(
                                color: widget.accentColor.withValues(alpha: 0.15),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Icon(Icons.insert_drive_file_outlined, color: widget.accentColor),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(f.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                                  Text(_formatBytes(f.size), style: const TextStyle(fontSize: 11, color: Colors.white54)),
                                ],
                              ),
                            ),
                            IconButton(
                              icon: const Icon(Icons.close, color: Colors.white38, size: 18),
                              onPressed: () => setState(() => _selectedFiles.removeAt(idx)),
                            ),
                          ],
                        ),
                      );
                    },
                  ),
          ),
          if (_selectedFiles.isNotEmpty) ...[
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: GlassButton(
                text: 'Select Peer on Radar',
                accentColor: widget.accentColor,
                onPressed: () => setState(() => _currentTabIndex = 0),
              ),
            ),
          ],
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // GLASS BOTTOM NAVIGATION BAR
  // ---------------------------------------------------------------------------
  Widget _buildGlassBottomNav() {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.04),
        border: Border(top: BorderSide(color: Colors.white.withValues(alpha: 0.08))),
      ),
      child: BottomNavigationBar(
        currentIndex: _currentTabIndex,
        onTap: (index) {
          HapticFeedback.selectionClick();
          setState(() => _currentTabIndex = index);
        },
        backgroundColor: Colors.transparent,
        elevation: 0,
        selectedItemColor: widget.accentColor,
        unselectedItemColor: Colors.white38,
        selectedFontSize: 11,
        unselectedFontSize: 11,
        type: BottomNavigationBarType.fixed,
        items: [
          const BottomNavigationBarItem(icon: Icon(Icons.near_me_rounded), label: 'Nearby'),
          BottomNavigationBarItem(
            icon: Stack(
              clipBehavior: Clip.none,
              children: [
                const Icon(Icons.attachment_rounded),
                if (_selectedFiles.isNotEmpty)
                  Positioned(
                    right: -4,
                    top: -2,
                    child: Container(
                      padding: const EdgeInsets.all(3),
                      decoration: BoxDecoration(color: widget.accentColor, shape: BoxShape.circle),
                      child: Text('${_selectedFiles.length}', style: const TextStyle(color: Colors.black, fontSize: 8, fontWeight: FontWeight.bold)),
                    ),
                  ),
              ],
            ),
            label: 'Tray',
          ),
          const BottomNavigationBarItem(icon: Icon(Icons.history_rounded), label: 'Library'),
          const BottomNavigationBarItem(icon: Icon(Icons.person_outline_rounded), label: 'Profile'),
          const BottomNavigationBarItem(icon: Icon(Icons.settings_outlined), label: 'Settings'),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // REAL-TIME TRANSFER PROGRESS HUD OVERLAY
  // ---------------------------------------------------------------------------
  Widget _buildTransferProgressHUD() {
    final double pct = (_totalTransferBytes > 0)
        ? (_transferredBytes / _totalTransferBytes).clamp(0.0, 1.0)
        : 0.0;

    String stateTitle = 'Connecting';
    if (_transferState == TransferState.connecting) stateTitle = 'Establishing Data Channel';
    if (_transferState == TransferState.preparing) stateTitle = 'Channel Ready';
    if (_transferState == TransferState.transferring) stateTitle = _isSender ? 'Sending to' : 'Receiving from';
    if (_transferState == TransferState.verifying) stateTitle = 'Verifying SHA-256 Checksum';
    if (_transferState == TransferState.completed) stateTitle = 'Transfer Complete';
    if (_transferState == TransferState.failed) stateTitle = 'Transfer Interrupted';

    return Container(
      color: Colors.black.withValues(alpha: 0.8),
      child: Center(
        child: Container(
          margin: const EdgeInsets.symmetric(horizontal: 24),
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: const Color(0xFF14161F),
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: widget.accentColor.withValues(alpha: 0.4), width: 1.5),
            boxShadow: [
              BoxShadow(color: widget.accentColor.withValues(alpha: 0.25), blurRadius: 30, spreadRadius: 2),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(stateTitle, style: const TextStyle(fontSize: 13, color: Colors.white60)),
                  Text('${(pct * 100).toInt()}%', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: widget.accentColor)),
                ],
              ),
              const SizedBox(height: 6),
              Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  _activePeer?.name ?? 'Nearby Peer',
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Colors.white),
                ),
              ),
              const SizedBox(height: 20),

              ClipRRect(
                borderRadius: BorderRadius.circular(6),
                child: LinearProgressIndicator(
                  value: pct,
                  minHeight: 8,
                  backgroundColor: Colors.white.withValues(alpha: 0.1),
                  valueColor: AlwaysStoppedAnimation<Color>(widget.accentColor),
                ),
              ),
              const SizedBox(height: 16),

              Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: 0.3),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    _buildMetricCol('TRANSFERRED', '${_formatBytes(_transferredBytes)} / ${_formatBytes(_totalTransferBytes)}'),
                    _buildMetricCol('SPEED', _formatSpeed(_speedBytesPerSec)),
                    _buildMetricCol('ETA', '${_etaSeconds}s'),
                  ],
                ),
              ),
              const SizedBox(height: 20),

              if (_transferState == TransferState.completed) ...[
                Row(
                  children: [
                    if (_lastSavedPath.isNotEmpty)
                      Expanded(
                        child: OutlinedButton(
                          style: OutlinedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            side: BorderSide(color: widget.accentColor),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                          ),
                          onPressed: () => NativeBridgeService.openFile(_lastSavedPath),
                          child: Text('Open File', style: TextStyle(color: widget.accentColor, fontWeight: FontWeight.bold)),
                        ),
                      ),
                    if (_lastSavedPath.isNotEmpty) const SizedBox(width: 12),
                    Expanded(
                      child: ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: widget.accentColor,
                          foregroundColor: const Color(0xFF0C0E14),
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                        onPressed: () {
                          setState(() {
                            _transferState = TransferState.idle;
                            _selectedFiles.clear();
                          });
                        },
                        child: const Text('Done', style: TextStyle(fontWeight: FontWeight.bold)),
                      ),
                    ),
                  ],
                ),
              ] else if (_transferState == TransferState.failed) ...[
                ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.white.withValues(alpha: 0.15),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 12),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  onPressed: () => setState(() => _transferState = TransferState.idle),
                  child: const Text('Close'),
                ),
              ] else ...[
                TextButton(
                  onPressed: _cancelTransfer,
                  child: const Text('Cancel Transfer', style: TextStyle(color: Color(0xFFF87171), fontWeight: FontWeight.w600)),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildMetricCol(String label, String value) {
    return Column(
      children: [
        Text(label, style: const TextStyle(fontSize: 9, letterSpacing: 1.0, color: Colors.white38, fontWeight: FontWeight.bold)),
        const SizedBox(height: 4),
        Text(value, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Colors.white)),
      ],
    );
  }
}
