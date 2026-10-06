import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Color(0xFF0C0D12),
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );
  runApp(const AuraDropApp());
}

// ---------------------------------------------------------------------------
// MODELS & ENUMS
// ---------------------------------------------------------------------------

enum TransferState {
  idle,
  searching,
  deviceSelected,
  dataChannelConnecting,
  readyToTransfer,
  waitingForAcceptance,
  transferring,
  verifying,
  completed,
  failed,
}

enum VisibilityMode {
  receivingOff,
  contactsOnly,
  everyoneNearby,
  temporaryEveryone,
}

class PeerDevice {
  final String id;
  final String name;
  final String platform;
  final String ip;
  final int port;
  final DateTime lastSeen;
  final bool isTrusted;

  PeerDevice({
    required this.id,
    required this.name,
    required this.platform,
    required this.ip,
    required this.port,
    required this.lastSeen,
    this.isTrusted = false,
  });

  factory PeerDevice.fromMap(Map<dynamic, dynamic> map, {bool isTrusted = false}) {
    return PeerDevice(
      id: map['id']?.toString() ?? '',
      name: map['name']?.toString() ?? 'Nearby Device',
      platform: map['platform']?.toString() ?? 'android',
      ip: map['ip']?.toString() ?? '127.0.0.1',
      port: (map['port'] as num?)?.toInt() ?? 48291,
      lastSeen: DateTime.now(),
      isTrusted: isTrusted,
    );
  }

  PeerDevice copyWith({bool? isTrusted}) {
    return PeerDevice(
      id: id,
      name: name,
      platform: platform,
      ip: ip,
      port: port,
      lastSeen: lastSeen,
      isTrusted: isTrusted ?? this.isTrusted,
    );
  }
}

class PickedFileMeta {
  final String id;
  final String name;
  final int size;
  final String mimeType;
  final String uri;

  PickedFileMeta({
    required this.id,
    required this.name,
    required this.size,
    required this.mimeType,
    required this.uri,
  });

  factory PickedFileMeta.fromMap(Map<dynamic, dynamic> map) {
    return PickedFileMeta(
      id: map['id']?.toString() ?? '',
      name: map['name']?.toString() ?? 'file',
      size: (map['size'] as num?)?.toInt() ?? 0,
      mimeType: map['mimeType']?.toString() ?? 'application/octet-stream',
      uri: map['uri']?.toString() ?? '',
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'name': name,
      'size': size,
      'mimeType': mimeType,
      'uri': uri,
    };
  }
}

class TransferHistoryItem {
  final String id;
  final String fileName;
  final int totalBytes;
  final String peerName;
  final bool isIncoming;
  final DateTime timestamp;
  final bool success;
  final String savedPath;

  TransferHistoryItem({
    required this.id,
    required this.fileName,
    required this.totalBytes,
    required this.peerName,
    required this.isIncoming,
    required this.timestamp,
    required this.success,
    this.savedPath = '',
  });
}

// ---------------------------------------------------------------------------
// MAIN APPLICATION
// ---------------------------------------------------------------------------

class AuraDropApp extends StatelessWidget {
  const AuraDropApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AuraDrop',
      debugShowCheckedModeBanner: false,
      themeMode: ThemeMode.dark,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF0C0D12),
        primaryColor: const Color(0xFF38BDF8),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF38BDF8),
          secondary: Color(0xFF818CF8),
          surface: Color(0xFF14161F),
          error: Color(0xFFF87171),
        ),
        fontFamily: 'Roboto',
      ),
      home: const AuraDropHomeScreen(),
    );
  }
}

// ---------------------------------------------------------------------------
// HOME SCREEN
// ---------------------------------------------------------------------------

class AuraDropHomeScreen extends StatefulWidget {
  const AuraDropHomeScreen({super.key});

  @override
  State<AuraDropHomeScreen> createState() => _AuraDropHomeScreenState();
}

class _AuraDropHomeScreenState extends State<AuraDropHomeScreen>
    with TickerProviderStateMixin, WidgetsBindingObserver {
  // Method & Event Channels
  static const MethodChannel _nativeChannel = MethodChannel('com.auradrop.app/native');
  static const EventChannel _eventChannel = EventChannel('com.auradrop.app/events');

  StreamSubscription? _eventSubscription;

  // Local Device Identity
  String _deviceId = 'android_local';
  String _deviceName = 'My Device';
  String _localIp = '127.0.0.1';

  // Visibility & Discovery State
  VisibilityMode _visibilityMode = VisibilityMode.everyoneNearby;
  Timer? _temporaryVisibilityTimer;
  int _temporarySecondsRemaining = 600; // 10 minutes default
  bool _isDiscovering = false;

  // Discovered Peers & Trusted Registry
  final Map<String, PeerDevice> _peers = {};
  final Set<String> _trustedPeerIds = {};

  // Selected Files
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
  String _verificationState = 'IDLE';
  String _lastSavedPath = '';

  // Transfer History
  final List<TransferHistoryItem> _history = [];

  // Navigation
  int _currentTabIndex = 0; // 0: Share / Radar, 1: Tray, 2: History

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
      duration: const Duration(milliseconds: 2400),
    )..repeat(reverse: true);

    _initNativeBridge();
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
      _checkInitialShareFiles();
    }
  }

  Future<void> _initNativeBridge() async {
    try {
      // 1. Request Runtime Permissions
      await _nativeChannel.invokeMethod('requestPermissions');

      // 2. Fetch Device Info
      final dynamic info = await _nativeChannel.invokeMethod('getDeviceInfo');
      if (info is Map) {
        setState(() {
          _deviceId = info['deviceId']?.toString() ?? _deviceId;
          _deviceName = info['deviceName']?.toString() ?? _deviceName;
          _localIp = info['ipAddress']?.toString() ?? _localIp;
        });
      }

      // 3. Start High-Speed TCP Transfer Server
      await _nativeChannel.invokeMethod('startTransferServer');

      // 4. Subscribe to Native Events
      _eventSubscription = _eventChannel.receiveBroadcastStream().listen(_onNativeEvent);

      // 5. Start Discovery based on current visibility
      _applyVisibilityMode(_visibilityMode);

      // 6. Check if app was opened via System Share Intent
      _checkInitialShareFiles();
    } catch (e) {
      debugPrint('Initialization error: $e');
    }
  }

  Future<void> _checkInitialShareFiles() async {
    try {
      final dynamic result = await _nativeChannel.invokeMethod('getInitialShareFiles');
      if (result is List && result.isNotEmpty) {
        setState(() {
          for (final f in result) {
            if (f is Map) {
              _selectedFiles.add(PickedFileMeta.fromMap(f));
            }
          }
          _currentTabIndex = 0; // Go directly to radar share view
        });
        _showSnackBar('${_selectedFiles.length} file(s) shared from system', isSuccess: true);
      }
    } catch (e) {
      debugPrint('Error checking share files: $e');
    }
  }

  void _onNativeEvent(dynamic event) {
    if (event is! Map) return;
    final String type = event['type']?.toString() ?? '';

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
        final stateStr = event['state']?.toString() ?? '';
        setState(() {
          if (stateStr == 'DATA_CHANNEL_CONNECTING') {
            _transferState = TransferState.dataChannelConnecting;
          } else if (stateStr == 'READY_TO_TRANSFER') {
            _transferState = TransferState.readyToTransfer;
          }
        });
        break;

      case 'transferRequest':
        HapticFeedback.heavyImpact();
        setState(() {
          _transferState = TransferState.waitingForAcceptance;
        });
        _showIncomingTransferSheet(event);
        break;

      case 'transferProgress':
        final stateStr = event['state']?.toString() ?? '';
        final xferBytes = (event['transferredBytes'] as num?)?.toInt() ?? _transferredBytes;
        final totBytes = (event['totalBytes'] as num?)?.toInt() ?? _totalTransferBytes;
        final speed = (event['speedBytesPerSec'] as num?)?.toInt() ?? _speedBytesPerSec;
        final eta = (event['etaSeconds'] as num?)?.toInt() ?? _etaSeconds;
        final vState = event['verificationState']?.toString() ?? _verificationState;
        final fName = event['fileName']?.toString() ?? _activeFileName;

        setState(() {
          _transferredBytes = xferBytes;
          _totalTransferBytes = math.max(1, totBytes);
          _speedBytesPerSec = speed;
          _etaSeconds = eta;
          _verificationState = vState;
          if (fName.isNotEmpty) _activeFileName = fName;

          if (stateStr == 'VERIFYING') {
            _transferState = TransferState.verifying;
          } else if (stateStr == 'TRANSFERRING') {
            _transferState = TransferState.transferring;
          }
        });
        break;

      case 'transferCompleted':
        HapticFeedback.mediumImpact();
        final xferId = event['transferId']?.toString() ?? _activeTransferId;
        final path = event['savedPath']?.toString() ?? '';
        final finalFileName = event['fileName']?.toString() ?? _activeFileName;
        final finalTotal = (event['totalBytes'] as num?)?.toInt() ?? _totalTransferBytes;

        setState(() {
          _transferState = TransferState.completed;
          _verificationState = 'VERIFIED';
          _lastSavedPath = path;
          _transferredBytes = finalTotal;

          _history.insert(
            0,
            TransferHistoryItem(
              id: xferId,
              fileName: finalFileName.isEmpty ? 'Files Transfer' : finalFileName,
              totalBytes: finalTotal,
              peerName: _activePeer?.name ?? 'Nearby Peer',
              isIncoming: !_isSender,
              timestamp: DateTime.now(),
              success: true,
              savedPath: path,
            ),
          );

          if (_activePeer != null) {
            _trustedPeerIds.add(_activePeer!.id);
          }
        });
        break;

      case 'transferError':
        HapticFeedback.vibrate();
        final err = event['error']?.toString() ?? 'Transfer failed';
        setState(() {
          _transferState = TransferState.failed;
          if (_activeFileName.isNotEmpty) {
            _history.insert(
              0,
              TransferHistoryItem(
                id: DateTime.now().millisecondsSinceEpoch.toString(),
                fileName: _activeFileName,
                totalBytes: _totalTransferBytes,
                peerName: _activePeer?.name ?? 'Nearby Peer',
                isIncoming: !_isSender,
                timestamp: DateTime.now(),
                success: false,
              ),
            );
          }
        });
        _showSnackBar(err, isSuccess: false);
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // VISIBILITY CONTROLS
  // ---------------------------------------------------------------------------
  Future<void> _applyVisibilityMode(VisibilityMode mode) async {
    _temporaryVisibilityTimer?.cancel();
    setState(() {
      _visibilityMode = mode;
    });

    if (mode == VisibilityMode.receivingOff) {
      await _nativeChannel.invokeMethod('stopDiscovery');
      setState(() {
        _isDiscovering = false;
        _peers.clear();
      });
    } else {
      await _nativeChannel.invokeMethod('startDiscovery');
      setState(() {
        _isDiscovering = true;
      });

      if (mode == VisibilityMode.temporaryEveryone) {
        _temporarySecondsRemaining = 600; // 10 minutes
        _temporaryVisibilityTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
          if (_temporarySecondsRemaining <= 1) {
            timer.cancel();
            _applyVisibilityMode(VisibilityMode.contactsOnly);
            _showSnackBar('Temporary visibility expired. Switched to Contacts Only.', isSuccess: true);
          } else {
            setState(() {
              _temporarySecondsRemaining--;
            });
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
    try {
      final dynamic result = await _nativeChannel.invokeMethod('pickFiles');
      if (result is List && result.isNotEmpty) {
        setState(() {
          for (final item in result) {
            if (item is Map) {
              _selectedFiles.add(PickedFileMeta.fromMap(item));
            }
          }
        });
        _showSnackBar('${result.length} file(s) selected', isSuccess: true);
      }
    } catch (e) {
      debugPrint('Error picking files: $e');
    }
  }

  void _clearSelectedFiles() {
    HapticFeedback.selectionClick();
    setState(() {
      _selectedFiles.clear();
    });
  }

  Future<void> _sendFilesToPeer(PeerDevice peer) async {
    if (_selectedFiles.isEmpty) {
      _showSnackBar('Select files before choosing a recipient.', isSuccess: false);
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
      _verificationState = 'STARTING';
      _transferState = TransferState.deviceSelected;
    });

    try {
      final payload = {
        'targetIp': peer.ip,
        'targetPort': peer.port,
        'files': _selectedFiles.map((f) => f.toMap()).toList(),
      };
      await _nativeChannel.invokeMethod('sendFiles', payload);
    } catch (e) {
      setState(() {
        _transferState = TransferState.failed;
      });
      _showSnackBar('Connection failed: $e', isSuccess: false);
    }
  }

  Future<void> _cancelTransfer() async {
    HapticFeedback.selectionClick();
    try {
      await _nativeChannel.invokeMethod('cancelTransfer', {
        'transferId': _activeTransferId,
      });
      setState(() {
        _transferState = TransferState.idle;
      });
    } catch (e) {
      debugPrint('Cancel error: $e');
    }
  }

  Future<void> _openReceivedFile(String path) async {
    if (path.isEmpty) return;
    HapticFeedback.lightImpact();
    try {
      final bool ok = await _nativeChannel.invokeMethod('openFile', {'filePath': path}) ?? false;
      if (!ok) {
        _showSnackBar('Could not open file viewer', isSuccess: false);
      }
    } catch (e) {
      _showSnackBar('Error opening file: $e', isSuccess: false);
    }
  }

  // ---------------------------------------------------------------------------
  // RECEIVER REQUEST SHEET
  // ---------------------------------------------------------------------------
  void _showIncomingTransferSheet(Map<dynamic, dynamic> req) {
    final transferId = req['transferId']?.toString() ?? '';
    final senderName = req['senderName']?.toString() ?? 'Nearby Device';
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
            border: Border.all(color: const Color(0xFF222634), width: 1.5),
            boxShadow: const [
              BoxShadow(
                color: Colors.black87,
                blurRadius: 30,
                offset: Offset(0, 10),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.white24,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 24),
              // Sender Avatar & Identity
              Container(
                width: 64,
                height: 64,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: const Color(0xFF1E2230),
                  border: Border.all(color: const Color(0xFF38BDF8), width: 1.5),
                ),
                child: Center(
                  child: Text(
                    senderName.isNotEmpty ? senderName.substring(0, 1).toUpperCase() : '?',
                    style: const TextStyle(
                      fontSize: 26,
                      fontWeight: FontWeight.w600,
                      color: Color(0xFF38BDF8),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Text(
                senderName,
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                  color: Colors.white,
                  letterSpacing: -0.3,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'wants to share $totalFiles file(s) • ${_formatBytes(totalBytes)}',
                style: const TextStyle(
                  fontSize: 14,
                  color: Colors.white60,
                ),
              ),
              const SizedBox(height: 20),

              // SAS Verification Pill
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                decoration: BoxDecoration(
                  color: const Color(0xFF0C0D12),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFF222634)),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.shield_outlined, color: Color(0xFF38BDF8), size: 16),
                    const SizedBox(width: 8),
                    Text(
                      'SAS CODE: $sas',
                      style: const TextStyle(
                        fontSize: 12,
                        letterSpacing: 1.2,
                        fontWeight: FontWeight.w600,
                        color: Color(0xFF38BDF8),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 28),

              // Action Buttons
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        side: const BorderSide(color: Color(0xFF33384B)),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                      ),
                      onPressed: () async {
                        Navigator.pop(ctx);
                        HapticFeedback.selectionClick();
                        await _nativeChannel.invokeMethod('declineTransfer', {
                          'transferId': transferId,
                        });
                        setState(() {
                          _transferState = TransferState.idle;
                        });
                      },
                      child: const Text(
                        'Decline',
                        style: TextStyle(
                          color: Color(0xFFF87171),
                          fontWeight: FontWeight.w600,
                          fontSize: 15,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF38BDF8),
                        foregroundColor: const Color(0xFF0C0D12),
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
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
                        await _nativeChannel.invokeMethod('acceptTransfer', {
                          'transferId': transferId,
                        });
                      },
                      child: const Text(
                        'Accept',
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                          fontSize: 15,
                        ),
                      ),
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

  // ---------------------------------------------------------------------------
  // VISIBILITY SELECTION SHEET
  // ---------------------------------------------------------------------------
  void _showVisibilityModal() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return Container(
          margin: const EdgeInsets.all(16),
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: const Color(0xFF14161F),
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: const Color(0xFF222634)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Nearby Visibility',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  color: Colors.white,
                ),
              ),
              const SizedBox(height: 6),
              const Text(
                'Choose who can discover this device on the local network.',
                style: TextStyle(fontSize: 13, color: Colors.white60),
              ),
              const SizedBox(height: 16),
              _buildVisibilityTile(
                title: 'Receiving Off',
                subtitle: 'Nobody can discover or send files to you',
                mode: VisibilityMode.receivingOff,
                ctx: ctx,
              ),
              _buildVisibilityTile(
                title: 'Contacts / Trusted Only',
                subtitle: 'Only devices you have previously trusted',
                mode: VisibilityMode.contactsOnly,
                ctx: ctx,
              ),
              _buildVisibilityTile(
                title: 'Everyone Nearby',
                subtitle: 'Any device on this Wi-Fi network',
                mode: VisibilityMode.everyoneNearby,
                ctx: ctx,
              ),
              _buildVisibilityTile(
                title: 'Everyone for 10 Minutes',
                subtitle: 'Switches back to Contacts Only after 10m',
                mode: VisibilityMode.temporaryEveryone,
                ctx: ctx,
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildVisibilityTile({
    required String title,
    required String subtitle,
    required VisibilityMode mode,
    required BuildContext ctx,
  }) {
    final isSelected = _visibilityMode == mode;
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
      onTap: () {
        Navigator.pop(ctx);
        _applyVisibilityMode(mode);
      },
      title: Text(
        title,
        style: TextStyle(
          fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
          color: isSelected ? const Color(0xFF38BDF8) : Colors.white,
          fontSize: 15,
        ),
      ),
      subtitle: Text(
        subtitle,
        style: const TextStyle(fontSize: 12, color: Colors.white54),
      ),
      trailing: isSelected
          ? const Icon(Icons.check_circle_rounded, color: Color(0xFF38BDF8))
          : const Icon(Icons.radio_button_unchecked_rounded, color: Colors.white24),
    );
  }

  void _showSnackBar(String text, {required bool isSuccess}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          text,
          style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
        ),
        backgroundColor: isSuccess ? const Color(0xFF10B981) : const Color(0xFFF87171),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        duration: const Duration(seconds: 3),
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
            Column(
              children: [
                _buildMinimalHeader(),
                Expanded(
                  child: IndexedStack(
                    index: _currentTabIndex,
                    children: [
                      _buildRadarShareView(),
                      _buildFileTrayView(),
                      _buildHistoryView(),
                    ],
                  ),
                ),
                _buildBottomBar(),
              ],
            ),
            // Deterministic Transfer HUD Overlay
            if (_transferState != TransferState.idle && _transferState != TransferState.searching)
              _buildTransferProgressModal(),
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // MINIMAL HEADER
  // ---------------------------------------------------------------------------
  Widget _buildMinimalHeader() {
    String visLabel = 'Everyone';
    if (_visibilityMode == VisibilityMode.receivingOff) visLabel = 'Off';
    if (_visibilityMode == VisibilityMode.contactsOnly) visLabel = 'Contacts';
    if (_visibilityMode == VisibilityMode.temporaryEveryone) {
      final m = _temporarySecondsRemaining ~/ 60;
      final s = _temporarySecondsRemaining % 60;
      visLabel = '$m:${s.toString().padLeft(2, '0')}';
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      decoration: const BoxDecoration(
        color: Color(0xFF0C0D12),
        border: Border(bottom: BorderSide(color: Color(0xFF1B1E29), width: 1)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: const Color(0xFF14161F),
                  border: Border.all(color: const Color(0xFF222634)),
                ),
                child: const Center(
                  child: Icon(Icons.near_me_rounded, color: Color(0xFF38BDF8), size: 16),
                ),
              ),
              const SizedBox(width: 10),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'AuraDrop',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.2,
                      color: Colors.white,
                    ),
                  ),
                  Text(
                    '$_deviceName • $_localIp',
                    style: const TextStyle(fontSize: 11, color: Colors.white54),
                  ),
                ],
              ),
            ],
          ),
          // Visibility Pill Button
          GestureDetector(
            onTap: _showVisibilityModal,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: const Color(0xFF14161F),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: const Color(0xFF222634)),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 7,
                    height: 7,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: _visibilityMode != VisibilityMode.receivingOff
                          ? const Color(0xFF38BDF8)
                          : Colors.white38,
                    ),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    visLabel,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: _visibilityMode != VisibilityMode.receivingOff
                          ? const Color(0xFF38BDF8)
                          : Colors.white54,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // RADAR SHARE VIEW (AIRDROP-CLASS EXPERIENCE)
  // ---------------------------------------------------------------------------
  Widget _buildRadarShareView() {
    final peerList = _peers.values.toList();
    // Sort so trusted devices appear first
    peerList.sort((a, b) {
      if (a.isTrusted && !b.isTrusted) return -1;
      if (!a.isTrusted && b.isTrusted) return 1;
      return a.name.compareTo(b.name);
    });

    return LayoutBuilder(
      builder: (context, constraints) {
        final center = Offset(constraints.maxWidth / 2, constraints.maxHeight * 0.44);
        final maxRadius = math.min(constraints.maxWidth, constraints.maxHeight) * 0.40;

        return Stack(
          children: [
            // CustomPainter for expanding scan waves
            CustomPaint(
              size: Size(constraints.maxWidth, constraints.maxHeight),
              painter: AuraScanWavePainter(
                angle: _radarController.value * 2 * math.pi,
                pulseFactor: _pulseController.value,
                isScanning: _isDiscovering && _transferState == TransferState.idle,
              ),
            ),

            // Center: Local Device
            Positioned(
              left: center.dx - 36,
              top: center.dy - 36,
              child: _buildLocalAvatar(center),
            ),

            // Discovered Peers positioned around radar
            for (int i = 0; i < peerList.length; i++)
              _buildPeerAvatarNode(
                peerList[i],
                i,
                peerList.length,
                center,
                maxRadius,
              ),

            // Bottom Share Tray Preview
            Positioned(
              left: 16,
              right: 16,
              bottom: 16,
              child: _buildShareSheetDrawer(),
            ),
          ],
        );
      },
    );
  }

  Widget _buildLocalAvatar(Offset center) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 72,
          height: 72,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: const Color(0xFF14161F),
            border: Border.all(color: const Color(0xFF38BDF8), width: 2),
            boxShadow: [
              BoxShadow(
                color: const Color(0xFF38BDF8).withValues(alpha: 0.15 + 0.15 * _pulseController.value),
                blurRadius: 18,
                spreadRadius: 2,
              ),
            ],
          ),
          child: const Center(
            child: Icon(Icons.person_rounded, color: Color(0xFF38BDF8), size: 36),
          ),
        ),
        const SizedBox(height: 6),
        const Text(
          'This Device',
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            color: Colors.white70,
          ),
        ),
      ],
    );
  }

  Widget _buildPeerAvatarNode(
    PeerDevice peer,
    int index,
    int total,
    Offset center,
    double radius,
  ) {
    final double step = (2 * math.pi) / total;
    final double angle = index * step - (math.pi / 2);
    final double nodeRadius = radius * (0.70 + (index % 2) * 0.20);
    final double dx = center.dx + nodeRadius * math.cos(angle) - 34;
    final double dy = center.dy + nodeRadius * math.sin(angle) - 34;

    final isSelected = _activePeer?.id == peer.id &&
        (_transferState == TransferState.transferring ||
            _transferState == TransferState.deviceSelected ||
            _transferState == TransferState.verifying);

    final double progressPct = _totalTransferBytes > 0
        ? (_transferredBytes / _totalTransferBytes).clamp(0.0, 1.0)
        : 0.0;

    return Positioned(
      left: dx,
      top: dy,
      child: GestureDetector(
        onTap: () => _sendFilesToPeer(peer),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Stack(
              alignment: Alignment.center,
              children: [
                // Determinate Circular Transfer Progress Ring
                if (isSelected)
                  SizedBox(
                    width: 76,
                    height: 76,
                    child: CircularProgressIndicator(
                      value: progressPct,
                      strokeWidth: 3.5,
                      strokeCap: StrokeCap.round,
                      backgroundColor: const Color(0xFF1F2433),
                      valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFF38BDF8)),
                    ),
                  ),

                Container(
                  width: 64,
                  height: 64,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: const Color(0xFF14161F),
                    border: Border.all(
                      color: peer.isTrusted ? const Color(0xFF818CF8) : const Color(0xFF222634),
                      width: 1.5,
                    ),
                  ),
                  child: Center(
                    child: Text(
                      peer.name.isNotEmpty ? peer.name.substring(0, 1).toUpperCase() : '?',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w700,
                        color: peer.isTrusted ? const Color(0xFF818CF8) : Colors.white,
                      ),
                    ),
                  ),
                ),

                if (peer.isTrusted)
                  Positioned(
                    right: 2,
                    top: 2,
                    child: Container(
                      padding: const EdgeInsets.all(2),
                      decoration: const BoxDecoration(
                        shape: BoxShape.circle,
                        color: Color(0xFF818CF8),
                      ),
                      child: const Icon(Icons.star, color: Colors.black, size: 10),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 6),
            Container(
              constraints: const BoxConstraints(maxWidth: 80),
              child: Text(
                peer.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: Colors.white,
                ),
              ),
            ),
            Text(
              isSelected ? '${(progressPct * 100).toInt()}%' : peer.ip,
              style: TextStyle(
                fontSize: 9,
                color: isSelected ? const Color(0xFF38BDF8) : Colors.white38,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildShareSheetDrawer() {
    final int count = _selectedFiles.length;
    final int totalSize = _selectedFiles.fold(0, (acc, f) => acc + f.size);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFF14161F),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFF222634)),
        boxShadow: const [
          BoxShadow(
            color: Colors.black45,
            blurRadius: 16,
            offset: Offset(0, 6),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: const Color(0xFF1E2230),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(Icons.folder_open_rounded, color: Color(0xFF38BDF8), size: 20),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  count > 0 ? '$count file(s) ready' : 'No files selected',
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: Colors.white,
                  ),
                ),
                Text(
                  count > 0 ? _formatBytes(totalSize) : 'Tap "+" to select files to share',
                  style: const TextStyle(fontSize: 11, color: Colors.white54),
                ),
              ],
            ),
          ),
          ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF38BDF8),
              foregroundColor: const Color(0xFF0C0D12),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              elevation: 0,
            ),
            onPressed: _pickFiles,
            icon: const Icon(Icons.add, size: 16),
            label: const Text(
              'Add',
              style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // FILE TRAY VIEW
  // ---------------------------------------------------------------------------
  Widget _buildFileTrayView() {
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
                  const Text(
                    'Selected Files',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      color: Colors.white,
                    ),
                  ),
                  Text(
                    '${_selectedFiles.length} file(s) in tray',
                    style: const TextStyle(fontSize: 12, color: Colors.white54),
                  ),
                ],
              ),
              Row(
                children: [
                  if (_selectedFiles.isNotEmpty)
                    IconButton(
                      icon: const Icon(Icons.delete_outline, color: Color(0xFFF87171), size: 20),
                      onPressed: _clearSelectedFiles,
                      tooltip: 'Clear Tray',
                    ),
                  ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF38BDF8),
                      foregroundColor: const Color(0xFF0C0D12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      elevation: 0,
                    ),
                    onPressed: _pickFiles,
                    icon: const Icon(Icons.add, size: 18),
                    label: const Text('Add Files', style: TextStyle(fontWeight: FontWeight.w600)),
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
                        const Text(
                          'File tray is empty',
                          style: TextStyle(fontSize: 15, color: Colors.white60),
                        ),
                      ],
                    ),
                  )
                : ListView.separated(
                    itemCount: _selectedFiles.length,
                    separatorBuilder: (context, index) => const SizedBox(height: 8),
                    itemBuilder: (context, idx) {
                      final f = _selectedFiles[idx];
                      return Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFF14161F),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: const Color(0xFF222634)),
                        ),
                        child: Row(
                          children: [
                            Container(
                              width: 40,
                              height: 40,
                              decoration: BoxDecoration(
                                color: const Color(0xFF1E2230),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: const Icon(Icons.insert_drive_file_outlined, color: Color(0xFF38BDF8)),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    f.name,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                                  ),
                                  Text(_formatBytes(f.size), style: const TextStyle(fontSize: 11, color: Colors.white54)),
                                ],
                              ),
                            ),
                            IconButton(
                              icon: const Icon(Icons.close, color: Colors.white38, size: 18),
                              onPressed: () {
                                setState(() {
                                  _selectedFiles.removeAt(idx);
                                });
                              },
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

  // ---------------------------------------------------------------------------
  // HISTORY VIEW
  // ---------------------------------------------------------------------------
  Widget _buildHistoryView() {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Transfer History',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w700,
              color: Colors.white,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            'Verified P2P transfers on this device',
            style: TextStyle(fontSize: 12, color: Colors.white54),
          ),
          const SizedBox(height: 16),
          Expanded(
            child: _history.isEmpty
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.history_rounded, size: 48, color: Colors.white.withValues(alpha: 0.2)),
                        const SizedBox(height: 12),
                        const Text(
                          'No transfers recorded yet',
                          style: TextStyle(fontSize: 15, color: Colors.white60),
                        ),
                      ],
                    ),
                  )
                : ListView.separated(
                    itemCount: _history.length,
                    separatorBuilder: (context, index) => const SizedBox(height: 8),
                    itemBuilder: (context, idx) {
                      final item = _history[idx];
                      return Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFF14161F),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: const Color(0xFF222634)),
                        ),
                        child: Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(8),
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: item.success
                                    ? const Color(0xFF10B981).withValues(alpha: 0.15)
                                    : const Color(0xFFF87171).withValues(alpha: 0.15),
                              ),
                              child: Icon(
                                item.isIncoming ? Icons.download_rounded : Icons.upload_rounded,
                                color: item.success ? const Color(0xFF10B981) : const Color(0xFFF87171),
                                size: 18,
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    item.fileName,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                                  ),
                                  Text(
                                    '${item.isIncoming ? "From" : "To"} ${item.peerName} • ${_formatBytes(item.totalBytes)}',
                                    style: const TextStyle(fontSize: 11, color: Colors.white54),
                                  ),
                                ],
                              ),
                            ),
                            if (item.savedPath.isNotEmpty)
                              TextButton(
                                onPressed: () => _openReceivedFile(item.savedPath),
                                child: const Text(
                                  'OPEN',
                                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF38BDF8)),
                                ),
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

  // ---------------------------------------------------------------------------
  // BOTTOM NAVIGATION
  // ---------------------------------------------------------------------------
  Widget _buildBottomBar() {
    return Container(
      decoration: const BoxDecoration(
        color: Color(0xFF0C0D12),
        border: Border(top: BorderSide(color: Color(0xFF1B1E29), width: 1)),
      ),
      child: BottomNavigationBar(
        currentIndex: _currentTabIndex,
        onTap: (index) {
          HapticFeedback.selectionClick();
          setState(() {
            _currentTabIndex = index;
          });
        },
        backgroundColor: Colors.transparent,
        elevation: 0,
        selectedItemColor: const Color(0xFF38BDF8),
        unselectedItemColor: Colors.white38,
        selectedFontSize: 11,
        unselectedFontSize: 11,
        items: [
          const BottomNavigationBarItem(
            icon: Icon(Icons.near_me_rounded),
            label: 'Nearby',
          ),
          BottomNavigationBarItem(
            icon: Stack(
              clipBehavior: Clip.none,
              children: [
                const Icon(Icons.folder_outlined),
                if (_selectedFiles.isNotEmpty)
                  Positioned(
                    right: -4,
                    top: -2,
                    child: Container(
                      padding: const EdgeInsets.all(3),
                      decoration: const BoxDecoration(
                        color: Color(0xFF38BDF8),
                        shape: BoxShape.circle,
                      ),
                      child: Text(
                        '${_selectedFiles.length}',
                        style: const TextStyle(color: Colors.black, fontSize: 8, fontWeight: FontWeight.bold),
                      ),
                    ),
                  ),
              ],
            ),
            label: 'Tray',
          ),
          const BottomNavigationBarItem(
            icon: Icon(Icons.history_rounded),
            label: 'History',
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // REAL-TIME TRANSFER PROGRESS MODAL
  // ---------------------------------------------------------------------------
  Widget _buildTransferProgressModal() {
    final double pct = (_totalTransferBytes > 0)
        ? (_transferredBytes / _totalTransferBytes).clamp(0.0, 1.0)
        : 0.0;

    String stateTitle = 'Connecting';
    if (_transferState == TransferState.dataChannelConnecting) stateTitle = 'Establishing Data Channel';
    if (_transferState == TransferState.readyToTransfer) stateTitle = 'Channel Ready';
    if (_transferState == TransferState.waitingForAcceptance) stateTitle = 'Awaiting Recipient Consent';
    if (_transferState == TransferState.transferring) stateTitle = _isSender ? 'Sending to' : 'Receiving from';
    if (_transferState == TransferState.verifying) stateTitle = 'Verifying SHA-256 Integrity';
    if (_transferState == TransferState.completed) stateTitle = 'Transfer Completed';
    if (_transferState == TransferState.failed) stateTitle = 'Transfer Failed';

    return Container(
      color: Colors.black.withValues(alpha: 0.75),
      child: Center(
        child: Container(
          margin: const EdgeInsets.symmetric(horizontal: 24),
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: const Color(0xFF14161F),
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: const Color(0xFF222634), width: 1.5),
            boxShadow: const [
              BoxShadow(
                color: Colors.black87,
                blurRadius: 30,
                offset: Offset(0, 10),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    stateTitle,
                    style: const TextStyle(fontSize: 13, color: Colors.white60),
                  ),
                  Text(
                    '${(pct * 100).toInt()}%',
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: Color(0xFF38BDF8),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  _activePeer?.name ?? 'Nearby Peer',
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                  ),
                ),
              ),
              const SizedBox(height: 20),

              // Progress Bar
              ClipRRect(
                borderRadius: BorderRadius.circular(6),
                child: LinearProgressIndicator(
                  value: pct,
                  minHeight: 8,
                  backgroundColor: const Color(0xFF1E2230),
                  valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFF38BDF8)),
                ),
              ),
              const SizedBox(height: 16),

              // Metrics Row
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                decoration: BoxDecoration(
                  color: const Color(0xFF0C0D12),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: const Color(0xFF1B1E29)),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    _buildMetric('TRANSFERRED', '${_formatBytes(_transferredBytes)} / ${_formatBytes(_totalTransferBytes)}'),
                    _buildMetric('SPEED', _formatSpeed(_speedBytesPerSec)),
                    _buildMetric('ETA', '${_etaSeconds}s'),
                  ],
                ),
              ),
              const SizedBox(height: 20),

              // Bottom Actions
              if (_transferState == TransferState.completed) ...[
                Row(
                  children: [
                    if (_lastSavedPath.isNotEmpty)
                      Expanded(
                        child: OutlinedButton(
                          style: OutlinedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            side: const BorderSide(color: Color(0xFF38BDF8)),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                          ),
                          onPressed: () => _openReceivedFile(_lastSavedPath),
                          child: const Text('Open File', style: TextStyle(color: Color(0xFF38BDF8), fontWeight: FontWeight.bold)),
                        ),
                      ),
                    if (_lastSavedPath.isNotEmpty) const SizedBox(width: 12),
                    Expanded(
                      child: ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF38BDF8),
                          foregroundColor: const Color(0xFF0C0D12),
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                          elevation: 0,
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
                    backgroundColor: const Color(0xFF222634),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 12),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  onPressed: () {
                    setState(() {
                      _transferState = TransferState.idle;
                    });
                  },
                  child: const Text('Close'),
                ),
              ] else ...[
                TextButton(
                  onPressed: _cancelTransfer,
                  child: const Text(
                    'Cancel Transfer',
                    style: TextStyle(color: Color(0xFFF87171), fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildMetric(String label, String value) {
    return Column(
      children: [
        Text(
          label,
          style: const TextStyle(fontSize: 9, letterSpacing: 1.0, color: Colors.white38, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 4),
        Text(
          value,
          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Colors.white),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// AIRDROP-CLASS RADAR SCAN PAINTER
// ---------------------------------------------------------------------------
class AuraScanWavePainter extends CustomPainter {
  final double angle;
  final double pulseFactor;
  final bool isScanning;

  AuraScanWavePainter({
    required this.angle,
    required this.pulseFactor,
    required this.isScanning,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height * 0.44);
    final maxRadius = math.min(size.width, size.height) * 0.42;

    // Concentric Subtle Orbit Rings
    final ringPaint = Paint()
      ..color = const Color(0xFF1B1E29)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0;

    for (int i = 1; i <= 3; i++) {
      final r = maxRadius * (i / 3.0);
      canvas.drawCircle(center, r, ringPaint);
    }

    // Dynamic Translucent Pulse Wave
    if (isScanning) {
      final dynamicRadius = maxRadius * (0.35 + 0.55 * pulseFactor);
      final pulsePaint = Paint()
        ..color = const Color(0xFF38BDF8).withValues(alpha: 0.10 * (1.0 - pulseFactor))
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5;
      canvas.drawCircle(center, dynamicRadius, pulsePaint);

      // Rotating Radar Beam
      final sweepPaint = Paint()
        ..shader = SweepGradient(
          center: Alignment(
            (center.dx / size.width) * 2 - 1,
            (center.dy / size.height) * 2 - 1,
          ),
          startAngle: angle - 0.4,
          endAngle: angle,
          colors: [
            Colors.transparent,
            const Color(0xFF38BDF8).withValues(alpha: 0.15),
          ],
        ).createShader(Rect.fromCircle(center: center, radius: maxRadius))
        ..style = PaintingStyle.fill;

      canvas.drawCircle(center, maxRadius, sweepPaint);
    }
  }

  @override
  bool shouldRepaint(covariant AuraScanWavePainter oldDelegate) {
    return oldDelegate.angle != angle ||
        oldDelegate.pulseFactor != pulseFactor ||
        oldDelegate.isScanning != isScanning;
  }
}
