import 'dart:async';
import 'dart:math' as math;
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'models/models.dart';
import 'theme/aura_theme.dart';
import 'components/hero_globe.dart';
import 'components/minimal_navigation.dart';
import 'components/minimal_components.dart';
import 'components/aura_data_stream.dart';
import 'components/aura_completion_burst.dart';
import 'components/notification_host.dart';
import 'services/native_bridge.dart';
import 'screens/transfers_screen.dart';
import 'screens/chat_screen.dart';
import 'screens/history_screen.dart';
import 'screens/profile_screen.dart';
import 'screens/settings_screen.dart';
import 'services/aura_signaling_service.dart';
import 'services/aura_webrtc_service.dart';
import 'services/aura_lan_server.dart';
import 'services/aura_identity_service.dart';
import 'services/aura_discovery_service.dart';
import 'services/aura_transfer_engine.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  if (Platform.isAndroid || Platform.isIOS) {
    SystemChrome.setSystemUIOverlayStyle(
      const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.light,
        systemNavigationBarColor: Color(0xFF000000),
        systemNavigationBarIconBrightness: Brightness.light,
      ),
    );
  }
  runApp(const AuraDropApp());
}

class AuraDropApp extends StatefulWidget {
  const AuraDropApp({super.key});

  @override
  State<AuraDropApp> createState() => _AuraDropAppState();
}

class _AuraDropAppState extends State<AuraDropApp> {
  String _themeMode = 'dark'; // 'system', 'light', 'dark'

  void _updateThemeMode(String mode) {
    setState(() => _themeMode = mode);
  }

  @override
  Widget build(BuildContext context) {
    ThemeMode mode;
    if (_themeMode == 'light') {
      mode = ThemeMode.light;
    } else if (_themeMode == 'system') {
      mode = ThemeMode.system;
    } else {
      mode = ThemeMode.dark;
    }

    final lightTheme = ThemeData(
      brightness: Brightness.light,
      scaffoldBackgroundColor: AuraTheme.light.background,
      primaryColor: AuraTheme.light.actionBackground,
      colorScheme: ColorScheme.light(
        primary: AuraTheme.light.actionBackground,
        surface: AuraTheme.light.background,
      ),
      dividerColor: AuraTheme.light.border,
      fontFamily: 'Roboto',
    );

    final darkTheme = ThemeData(
      brightness: Brightness.dark,
      scaffoldBackgroundColor: AuraTheme.dark.background,
      primaryColor: AuraTheme.dark.actionBackground,
      colorScheme: ColorScheme.dark(
        primary: AuraTheme.dark.actionBackground,
        surface: AuraTheme.dark.background,
      ),
      dividerColor: AuraTheme.dark.border,
      fontFamily: 'Roboto',
    );

    return MaterialApp(
      title: 'AuraDrop',
      debugShowCheckedModeBanner: false,
      themeMode: mode,
      theme: lightTheme,
      darkTheme: darkTheme,
      home: AuraDropHomeScreen(
        currentThemeMode: _themeMode,
        onThemeModeChanged: _updateThemeMode,
      ),
    );
  }
}

class AuraDropHomeScreen extends StatefulWidget {
  final String currentThemeMode;
  final ValueChanged<String> onThemeModeChanged;

  const AuraDropHomeScreen({
    super.key,
    required this.currentThemeMode,
    required this.onThemeModeChanged,
  });

  @override
  State<AuraDropHomeScreen> createState() => _AuraDropHomeScreenState();
}

class _AuraDropHomeScreenState extends State<AuraDropHomeScreen>
    with WidgetsBindingObserver {
  // Navigation: 0: Home, 1: Transfers, 2: Chat, 3: History, 4: Profile
  int _currentTabIndex = 0;

  // Subscriptions & Timers
  StreamSubscription? _eventSubscription;
  StreamSubscription? _discoverySubscription;
  StreamSubscription? _transferProgressSubscription;
  StreamSubscription? _transferCompleteSubscription;
  StreamSubscription? _transferErrorSubscription;
  Timer? _temporaryVisibilityTimer;
  Timer? _peerCleanupTimer;
  int _temporarySecondsRemaining = 600;

  // Local Device Identity & Profile
  String _deviceId = 'android_local';
  String _deviceName = '';
  String _localIp = '127.0.0.1';
  UserProfile _userProfile = UserProfile(
    displayName: '',
    avatarIndex: 0,
    bio: 'Nearby sharing made effortless',
    theme: 'system',
    accent: 'white',
    visibility: 'everyone',
  );

  // Settings & Animation
  AnimationSettings _animationSettings = const AnimationSettings();

  // Visibility & Discovery
  VisibilityMode _visibilityMode = VisibilityMode.everyoneNearby;
  bool _isDiscovering = false;

  // Discovered Peers
  final Map<String, PeerDevice> _peers = {};
  final Set<String> _trustedPeerIds = {};
  PeerDevice? _selectedPeer;

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
  String _lastSha256 = '';
  String _lastErrorMessage = '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _initApp();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _temporaryVisibilityTimer?.cancel();
    _peerCleanupTimer?.cancel();
    _eventSubscription?.cancel();
    _discoverySubscription?.cancel();
    _transferProgressSubscription?.cancel();
    _transferCompleteSubscription?.cancel();
    _transferErrorSubscription?.cancel();
    AuraDiscoveryService().stop();
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

      final realDevName = info['deviceName']?.toString() ?? 'Unknown Device';
      final realDispName = (prof.displayName.isNotEmpty && prof.displayName != 'AuraDrop User')
          ? prof.displayName
          : realDevName;

      await AuraIdentityService().init();
      final idService = AuraIdentityService();
      if (idService.deviceId.isNotEmpty) {
        _deviceId = idService.deviceId;
      }
      if (idService.deviceName.isNotEmpty && _deviceName.isEmpty) {
        _deviceName = idService.deviceName;
      }

      setState(() {
        _deviceId = info['deviceId']?.toString() ?? _deviceId;
        _deviceName = realDispName.isNotEmpty ? realDispName : _deviceName;
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

      // Start Native UDP Auto-Discovery & Direct Transfer Engine
      await AuraDiscoveryService().start();
      AuraTransferEngine().init();

      _discoverySubscription = AuraDiscoveryService().onPeersChanged.listen((peers) {
        if (!mounted) return;
        final currentPeerIds = peers.map((p) => p.id).toSet();
        setState(() {
          for (final p in peers) {
            _peers[p.id] = p;
          }
          _peers.removeWhere((id, p) => p.transport.contains('Wi-Fi') && !currentPeerIds.contains(id));
          if (_selectedPeer != null && !_peers.containsKey(_selectedPeer!.id)) {
            _selectedPeer = null;
          }
        });
      });

      _transferProgressSubscription = AuraTransferEngine().onProgress.listen((p) {
        if (!mounted) return;
        setState(() {
          _activeTransferId = p.transferId;
          _activeFileName = p.fileName;
          _transferredBytes = p.transferredBytes;
          _totalTransferBytes = math.max(1, p.totalBytes);
          _speedBytesPerSec = (p.speedMBps * 1024 * 1024).toInt();
          _etaSeconds = p.etaSeconds;
          _isSender = p.isSender;
          if (p.state == 'TRANSFERRING') {
            _transferState = TransferState.transferring;
          } else if (p.state == 'WAITING_FOR_ACCEPT') {
            _transferState = TransferState.waitingForAccept;
          } else if (p.state == 'VERIFYING') {
            _transferState = TransferState.verifying;
          }
        });
      });

      _transferCompleteSubscription = AuraTransferEngine().onCompleted.listen((data) async {
        if (!mounted) return;
        HapticFeedback.heavyImpact();
        final path = data['filePath']?.toString() ?? _lastSavedPath;
        final fName = data['fileName']?.toString() ?? _activeFileName;
        final fSize = (data['fileSize'] as num?)?.toInt() ?? _totalTransferBytes;
        final sha = data['sha256']?.toString() ?? '';
        final isSender = data['isSender'] == true;
        final peerName = _activePeer?.name ?? 'Nearby Peer';

        // 1. Record in native SQLite database and trigger MediaScanner
        await NativeBridgeService.recordTransferHistory(
          id: data['transferId']?.toString() ?? 'xfer_${DateTime.now().millisecondsSinceEpoch}',
          senderName: isSender ? _deviceName : peerName,
          receiverName: isSender ? peerName : _deviceName,
          fileName: fName,
          fileSize: fSize,
          direction: isSender ? 'sent' : 'received',
          status: 'completed',
          sha256: sha,
          localPath: path,
          transportType: 'LAN_TURBO_DIRECT',
          avgSpeed: _speedBytesPerSec,
        );

        // 2. Show in-app notification with tap-to-open
        InAppNotificationController().showTransferComplete(
          fileName: fName,
          onOpen: () async {
            if (path.isNotEmpty) {
              await NativeBridgeService.openFile(path);
            }
          },
        );

        setState(() {
          _transferState = TransferState.completed;
          _activeFileName = fName;
          _lastSavedPath = path;
          _lastSha256 = sha;
          _transferredBytes = fSize;
          _totalTransferBytes = math.max(1, fSize);
          _speedBytesPerSec = 0;
          _etaSeconds = 0;
        });
        _showSnackBar('✓ Transfer complete: $fName', isSuccess: true);
      });

      _transferErrorSubscription = AuraTransferEngine().onError.listen((err) {
        if (!mounted) return;
        HapticFeedback.vibrate();
        setState(() {
          _transferState = TransferState.failed;
          _lastErrorMessage = err;
        });
        _showSnackBar(err, isSuccess: false);
      });

      // Initialize AuraDrop LAN Turbo & WebRTC P2P (V24 Persistent Architecture)
      await AuraSignalingService().initPersistedUrl();
      await AuraSignalingService().initTrustedPeers();
      await AuraLanServer().start(
        deviceId: _deviceId,
        deviceName: _deviceName,
      );
      AuraSignalingService().updateLanEndpoint(
        localIp: AuraLanServer().localIp,
        localPort: AuraLanServer().port,
      );

      AuraSignalingService().configureIdentity(
        deviceId: _deviceId,
        displayName: _deviceName,
        deviceName: _deviceName,
        visibility: _userProfile.visibility,
        avatarIndex: _userProfile.avatarIndex,
      );
      AuraWebRtcService().init();
      AuraSignalingService().connect();

      // Hook reactive LAN Turbo HTTP Server events
      AuraLanServer().onTransferRequest.listen((req) {
        if (!mounted) return;
        final transferId = req['transferId']?.toString() ?? '';
        final senderName = req['senderName']?.toString() ?? req['senderUserId']?.toString() ?? 'Nearby Peer';
        final fileSize = (req['fileSize'] as num?)?.toInt() ?? 0;
        final fileName = req['fileName']?.toString() ?? 'Incoming File';

        NativeBridgeService.showSystemIncomingShareNotification(
          transferId: transferId,
          senderName: senderName,
          senderDeviceName: senderName,
          totalFiles: 1,
          totalBytes: fileSize,
          fileName: fileName,
        );

        InAppNotificationController().showTransferRequest(
          transferId: transferId,
          senderName: senderName,
          fileName: fileName,
          fileSize: fileSize,
          onAccept: () async {
            setState(() {
              _transferState = TransferState.transferring;
              _activeTransferId = transferId;
              _isSender = false;
              _totalTransferBytes = math.max(1, fileSize);
              _transferredBytes = 0;
              _activeFileName = fileName;
            });
          },
          onDecline: () async {
            setState(() => _transferState = TransferState.idle);
          },
        );

        _showIncomingTransferModal({
          'transferId': transferId,
          'senderName': senderName,
          'fileName': fileName,
          'totalBytes': fileSize,
          'totalFiles': 1,
          'sas': 'Direct Wi-Fi',
        });
      });

      // Hook reactive WebRTC & Signaling events
      AuraSignalingService().onPeerList.listen((peers) {
        if (!mounted) return;
        setState(() {
          for (final p in peers) {
            _peers[p.id] = p;
          }
        });
      });

      AuraSignalingService().onPeerOnline.listen((peer) {
        if (!mounted) return;
        final isNew = !_peers.containsKey(peer.id);
        setState(() {
          _peers[peer.id] = peer;
        });
        if (isNew) {
          NativeBridgeService.showNameDropProximityAlert(
            peerId: peer.id,
            peerName: peer.name,
          );
          InAppNotificationController().showNameDrop(
            peerName: peer.name,
            deviceName: peer.deviceName,
            onTap: () {
              setState(() => _selectedPeer = peer);
            },
          );
        }
      });

      AuraSignalingService().onPeerOffline.listen((peerId) {
        if (!mounted) return;
        setState(() {
          _peers.remove(peerId);
          if (_selectedPeer?.id == peerId) _selectedPeer = null;
        });
      });

      AuraSignalingService().onTransferRequest.listen((req) {
        if (!mounted) return;
        _handleSignalingTransferRequest(req);
      });

      AuraSignalingService().onTransferAccept.listen((acc) {
        if (!mounted) return;
        _handleSignalingTransferAccept(acc);
      });

      AuraWebRtcService().onProgress.listen((p) {
        if (!mounted) return;
        setState(() {
          _transferredBytes = p.transferredBytes;
          _totalTransferBytes = math.max(1, p.totalBytes);
          _speedBytesPerSec = (p.speedMBps * 1024 * 1024).toInt();
          _etaSeconds = p.etaSeconds;
          _activeFileName = p.fileName;
        });
      });

      AuraWebRtcService().onTransferComplete.listen((data) {
        if (!mounted) return;
        HapticFeedback.heavyImpact();
        setState(() {
          _transferState = TransferState.completed;
          _lastSavedPath = data['filePath']?.toString() ?? '';
          _lastSha256 = data['sha256']?.toString() ?? '';
        });
      });

      AuraWebRtcService().onConnectionState.listen((st) {
        if (!mounted) return;
        if (st == 'READY_TO_TRANSFER') {
          // Connected
        } else if (st == 'FAILED') {
          setState(() => _transferState = TransferState.failed);
        }
      });
      
      _peerCleanupTimer = Timer.periodic(const Duration(seconds: 2), (_) {
        if (!mounted) return;
        final now = DateTime.now();
        bool changed = false;
        _peers.removeWhere((id, peer) {
          if (now.difference(peer.lastSeen).inSeconds > 10) {
            if (_selectedPeer?.id == id) _selectedPeer = null;
            changed = true;
            return true;
          }
          return false;
        });
        if (changed) setState(() {});
      });

      // Prompt overlay permission so floating NameDrop / Dynamic Island works 1000% over other apps & home screen
      Future.delayed(const Duration(milliseconds: 1500), () async {
        final hasOverlay = await NativeBridgeService.checkOverlayPermission();
        if (!hasOverlay && mounted) {
          NativeBridgeService.requestOverlayPermission();
        }
      });
      
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
          final isNew = !_peers.containsKey(peer.id);
          setState(() {
            _peers[peer.id] = peer;
          });
          if (isNew) {
            NativeBridgeService.showNameDropProximityAlert(
              peerId: peer.id,
              peerName: peer.name,
            );
            InAppNotificationController().showNameDrop(
              peerName: peer.name,
              deviceName: peer.deviceName,
              onTap: () {
                setState(() => _selectedPeer = peer);
              },
            );
          }
        }
        break;

      case 'dataChannelState':
        final st = event['state']?.toString();
        setState(() {
          if (st == 'READY_TO_TRANSFER') {
            if (_selectedPeer != null) {
              _selectedPeer = _selectedPeer!.copyWith(connectionState: 'READY_TO_TRANSFER');
            }
          }
        });
        break;

      case 'transferRequest':
        HapticFeedback.heavyImpact();
        setState(() => _transferState = TransferState.waitingForAccept);
        final transferId = event['transferId']?.toString() ?? '';
        final senderName = event['senderName']?.toString() ?? 'Nearby Peer';
        final totalBytes = (event['totalBytes'] as num?)?.toInt() ?? 0;
        final totalFiles = (event['totalFiles'] as num?)?.toInt() ?? 1;
        final fileName = event['fileName']?.toString() ?? (totalFiles == 1 ? 'Incoming File' : '$totalFiles Files');

        InAppNotificationController().showTransferRequest(
          transferId: transferId,
          senderName: senderName,
          fileName: fileName,
          fileSize: totalBytes,
          onAccept: () async {
            setState(() {
              _transferState = TransferState.transferring;
              _activeTransferId = transferId;
              _isSender = false;
              _totalTransferBytes = math.max(1, totalBytes);
              _transferredBytes = 0;
              _activePeer = PeerDevice(
                id: 'sender',
                name: senderName,
                deviceName: senderName,
                platform: 'android',
                ip: '127.0.0.1',
                port: 48291,
                lastSeen: DateTime.now(),
              );
            });
            await NativeBridgeService.acceptTransfer(transferId);
          },
          onDecline: () async {
            setState(() => _transferState = TransferState.idle);
            await NativeBridgeService.declineTransfer(transferId);
          },
        );
        _showIncomingTransferModal(event);
        break;

      case 'peerExpired':
        final expiredId = event['peerId']?.toString();
        if (expiredId != null) {
          setState(() {
            _peers.remove(expiredId);
            if (_selectedPeer?.id == expiredId) _selectedPeer = null;
          });
        }
        break;

      case 'chatMessageReceived':
        final pId = event['peerId']?.toString() ?? '';
        final sName = event['senderName']?.toString() ?? 'Unknown Device';
        final text = event['text']?.toString() ?? '';
        if (_currentTabIndex != 2) {
          InAppNotificationController().showChatMessage(
            peerId: pId,
            senderName: sName,
            text: text,
            onTap: () {
              setState(() => _currentTabIndex = 2);
            },
          );
        }
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

          if (st != null && st.isNotEmpty) {
            _transferState = TransferState.fromString(st);
          } else {
            _transferState = TransferState.transferring;
          }
        });
        break;

      case 'transferCompleted':
        HapticFeedback.mediumImpact();
        final path = event['savedPath']?.toString() ?? '';
        final finalFileName = event['fileName']?.toString() ?? _activeFileName;
        final finalTotal = (event['totalBytes'] as num?)?.toInt() ?? _totalTransferBytes;
        final sha = event['sha256']?.toString() ?? '';

        InAppNotificationController().showTransferComplete(
          fileName: finalFileName,
          onOpen: () async {
            if (path.isNotEmpty) {
              await NativeBridgeService.openFile(path);
            }
          },
        );

        setState(() {
          _transferState = TransferState.completed;
          _activeFileName = finalFileName;
          _lastSavedPath = path;
          _transferredBytes = finalTotal;
          _lastSha256 = sha;

          if (_activePeer != null) {
            _trustedPeerIds.add(_activePeer!.id);
            NativeBridgeService.setPeerTrusted(_activePeer!.id, _activePeer!.name, true);
          }
        });
        break;

      case 'notificationAccept':
        final tId = event['transferId']?.toString() ?? '';
        if (tId == _activeTransferId && _activePeer != null) {
          setState(() {
            _transferState = TransferState.transferring;
            _transferredBytes = 0;
          });
          AuraSignalingService().sendTransferAccept(
            targetDeviceId: _activePeer!.id,
            transferId: tId,
          );
        }
        break;

      case 'notificationDecline':
        final tId = event['transferId']?.toString() ?? '';
        if (tId == _activeTransferId && _activePeer != null) {
          setState(() {
            _transferState = TransferState.idle;
            _activeTransferId = '';
          });
          AuraSignalingService().sendTransferDecline(
            targetDeviceId: _activePeer!.id,
            transferId: tId,
          );
        }
        break;

      case 'transferError':
        HapticFeedback.vibrate();
        final err = event['error']?.toString() ?? 'Transfer failed';
        setState(() {
          _transferState = TransferState.failed;
          _lastErrorMessage = err;
        });
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
        _selectedPeer = null;
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
      await _pickFiles();
      if (_selectedFiles.isEmpty) return;
    }

    HapticFeedback.mediumImpact();
    final totalSize = _selectedFiles.fold(0, (acc, f) => acc + f.size);

    setState(() {
      _activePeer = peer;
      _isSender = true;
      _activeTransferId = 'send_${DateTime.now().millisecondsSinceEpoch}';
      _activeFileName = _selectedFiles.length == 1
          ? _selectedFiles.first.name
          : '${_selectedFiles.length} files';
      _transferredBytes = 0;
      _totalTransferBytes = math.max(1, totalSize);
      _speedBytesPerSec = 0;
      _etaSeconds = 0;
      _transferState = TransferState.waitingForAccept;
    });

    // 1. Direct High-Speed Wi-Fi LAN HTTP Socket streaming route (AirDrop / LocalSend class)
    if (peer.ip.isNotEmpty && peer.ip != 'WebRTC P2P' && peer.port > 0) {
      bool allSuccess = true;
      for (final f in _selectedFiles) {
        final filePath = f.path.isNotEmpty ? f.path : f.uri;
        final success = await AuraTransferEngine().sendFile(
          target: peer,
          filePath: filePath,
          fileName: f.name,
          fileSize: f.size,
        );
        if (!success) {
          allSuccess = false;
          break;
        }
      }
      if (allSuccess) {
        _showSnackBar('✓ All files sent successfully!', isSuccess: true);
      }
      return;
    }

    // 2. WebRTC Direct Route (Cloud Fallback)
    if (peer.transport.contains('WebRTC') || peer.ip == 'WebRTC P2P') {
      try {
        debugPrint('[AuraDrop] Initiating WebRTC P2P transfer to ${peer.name} (${peer.id})');
        await AuraWebRtcService().connectToPeer(peer.id);

        AuraSignalingService().sendTransferRequest(
          targetDeviceId: peer.id,
          transferId: _activeTransferId,
          fileName: _activeFileName,
          totalBytes: totalSize,
          totalFiles: _selectedFiles.length,
          files: _selectedFiles.map((f) => f.toMap()).toList(),
        );
      } catch (e) {
        setState(() => _transferState = TransferState.failed);
        _showSnackBar('WebRTC transfer failed: $e', isSuccess: false);
      }
      return;
    }

    // 3. Android MethodChannel fallback
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

  void _handleSignalingTransferRequest(Map<String, dynamic> event) {
    HapticFeedback.heavyImpact();
    setState(() => _transferState = TransferState.waitingForAccept);

    final transferId = event['transferId']?.toString() ?? '';
    final senderName = event['senderName']?.toString() ?? event['senderDeviceName']?.toString() ?? 'Nearby Peer';
    final senderId = event['senderId']?.toString() ?? '';
    final totalBytes = (event['totalBytes'] as num?)?.toInt() ?? 0;
    final totalFiles = (event['totalFiles'] as num?)?.toInt() ?? 1;
    final fileName = event['fileName']?.toString() ?? (totalFiles == 1 ? 'Incoming File' : '$totalFiles Files');

    _activeTransferId = transferId;
    _activePeer = PeerDevice(
      id: senderId,
      name: senderName,
      deviceName: senderName,
      platform: 'web',
      ip: 'WebRTC P2P',
      port: 0,
      lastSeen: DateTime.now(),
      transport: 'WebRTC Direct',
    );

    NativeBridgeService.showSystemIncomingShareNotification(
      transferId: transferId,
      senderName: senderName,
      senderDeviceName: senderName,
      totalFiles: totalFiles,
      totalBytes: totalBytes,
      fileName: fileName,
    );

    InAppNotificationController().showTransferRequest(
      transferId: transferId,
      senderName: senderName,
      fileName: fileName,
      fileSize: totalBytes,
      onAccept: () async {
        setState(() {
          _transferState = TransferState.transferring;
          _activeTransferId = transferId;
          _isSender = false;
          _totalTransferBytes = math.max(1, totalBytes);
          _transferredBytes = 0;
          _activePeer = PeerDevice(
            id: senderId,
            name: senderName,
            deviceName: senderName,
            platform: 'web',
            ip: 'WebRTC P2P',
            port: 0,
            lastSeen: DateTime.now(),
            transport: 'WebRTC Direct',
          );
        });

        AuraSignalingService().sendTransferAccept(
          targetDeviceId: senderId,
          transferId: transferId,
        );
      },
      onDecline: () async {
        setState(() => _transferState = TransferState.idle);
        AuraSignalingService().sendTransferDecline(
          targetDeviceId: senderId,
          transferId: transferId,
        );
      },
    );
  }

  Future<void> _handleSignalingTransferAccept(Map<String, dynamic> event) async {
    final transferId = event['transferId']?.toString() ?? '';
    if (transferId != _activeTransferId) return;

    setState(() {
      _transferState = TransferState.transferring;
    });

    for (final f in _selectedFiles) {
      try {
        File? fileToStream;
        if (f.uri.startsWith('content://')) {
          final cachedPath = await NativeBridgeService.copyUriToCache(f.uri, f.name);
          if (cachedPath != null) {
            fileToStream = File(cachedPath);
          }
        } else {
          fileToStream = File(f.uri);
        }

        if (fileToStream != null && await fileToStream.exists()) {
          await AuraWebRtcService().sendFile(
            file: fileToStream,
            transferId: transferId,
          );
        }
      } catch (e) {
        debugPrint('Error streaming WebRTC file: $e');
      }
    }
  }

  Future<void> _cancelTransfer() async {
    HapticFeedback.selectionClick();
    AuraTransferEngine().cancelActiveTransfer();
    AuraWebRtcService().cancelTransfer();
    if (_activeTransferId.isNotEmpty) {
      await NativeBridgeService.cancelTransfer(_activeTransferId);
    }
    setState(() => _transferState = TransferState.idle);
  }

  void _showIncomingTransferModal(Map<dynamic, dynamic> req) {
    final theme = AuraTheme.of(context);
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
            color: theme.cardBackground,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: theme.border, width: 1.0),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: theme.textSecondary.withValues(alpha: 0.3),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 20),
              Container(
                width: 56,
                height: 56,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: theme.textPrimary,
                ),
                child: Center(
                  child: Text(
                    senderName.isNotEmpty ? senderName.substring(0, 1).toUpperCase() : '?',
                    style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: theme.actionText),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Text(
                senderName,
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: theme.textPrimary),
              ),
              const SizedBox(height: 4),
              Text(
                'wants to send $totalFiles file(s) • ${_formatBytes(totalBytes)}',
                style: TextStyle(fontSize: 13, color: theme.textSecondary),
              ),
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                decoration: BoxDecoration(
                  color: theme.background,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: theme.border),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.shield_outlined, size: 14, color: theme.textSecondary),
                    const SizedBox(width: 8),
                    Text(
                      'SAS: $sas',
                      style: TextStyle(
                        fontSize: 12,
                        fontFamily: 'monospace',
                        fontWeight: FontWeight.w600,
                        color: theme.textPrimary,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),
              Row(
                children: [
                  Expanded(
                    child: SizedBox(
                      height: 48,
                      child: ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: theme.isDark ? const Color(0xFF3A3A3C) : const Color(0xFFD1D1D6),
                          foregroundColor: theme.isDark ? Colors.white : Colors.black87,
                          elevation: 0,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
                        ),
                        onPressed: () async {
                          Navigator.pop(ctx);
                          InAppNotificationController().dismissById('req_$transferId');
                          setState(() => _transferState = TransferState.idle);
                          await NativeBridgeService.declineTransfer(transferId);
                        },
                        child: const Text('Decline', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: SizedBox(
                      height: 48,
                      child: ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF0A84FF),
                          foregroundColor: Colors.white,
                          elevation: 0,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
                        ),
                        onPressed: () async {
                          Navigator.pop(ctx);
                          InAppNotificationController().dismissById('req_$transferId');
                          setState(() {
                            _transferState = TransferState.transferring;
                            _activeTransferId = transferId;
                            _isSender = false;
                            _totalTransferBytes = math.max(1, totalBytes);
                            _transferredBytes = 0;
                            _activePeer = PeerDevice(
                              id: 'sender',
                              name: senderName,
                              deviceName: senderName,
                              platform: 'android',
                              ip: '127.0.0.1',
                              port: 48291,
                              lastSeen: DateTime.now(),
                            );
                          });
                          await NativeBridgeService.acceptTransfer(transferId);
                        },
                        child: const Text('Accept', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
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



  void _showSnackBar(String text, {required bool isSuccess}) {
    final theme = AuraTheme.of(context);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          text,
          style: TextStyle(
            fontWeight: FontWeight.w600,
            fontSize: 13,
            color: isSuccess ? theme.actionText : Colors.white,
          ),
        ),
        backgroundColor: isSuccess ? theme.actionBackground : const Color(0xFFEF4444),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    );
  }

  String _formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    if (bytes < 1024 * 1024 * 1024) return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(2)} GB';
  }

  // ---------------------------------------------------------------------------
  // MAIN BUILD
  // ---------------------------------------------------------------------------
  @override
  Widget build(BuildContext context) {
    final theme = AuraTheme.of(context);

    return InAppNotificationHost(
      child: Scaffold(
        backgroundColor: theme.background,
        body: SafeArea(
          child: Stack(
            children: [
              Column(
                children: [
                  _buildHeader(theme),
                  Expanded(
                    child: IndexedStack(
                      index: _currentTabIndex,
                      children: [
                        _buildHomeScreen(theme),
                        TransfersScreen(
                          selectedFiles: _selectedFiles,
                          onPickFiles: _pickFiles,
                          onRemoveFile: (f) => setState(() => _selectedFiles.remove(f)),
                          onClearFiles: () => setState(() => _selectedFiles.clear()),
                          transferState: _transferState,
                          activeFileName: _activeFileName,
                          transferredBytes: _transferredBytes,
                          totalTransferBytes: _totalTransferBytes,
                          speedBytesPerSec: _speedBytesPerSec,
                          etaSeconds: _etaSeconds,
                          onCancelTransfer: _cancelTransfer,
                          isIncoming: !_isSender,
                        ),
                        ChatHubScreen(peers: _peers),
                        const HistoryScreen(),
                        ProfileScreen(
                          profile: _userProfile,
                          onProfileUpdated: (key, val) {
                            if (key == 'display_name') setState(() => _deviceName = val);
                            if (key == 'theme') widget.onThemeModeChanged(val);
                            if (key == 'avatar_path') {
                              setState(() {
                                _userProfile = UserProfile(
                                  displayName: _userProfile.displayName,
                                  deviceName: _userProfile.deviceName,
                                  avatarIndex: _userProfile.avatarIndex,
                                  avatarPath: val,
                                  bio: _userProfile.bio,
                                  theme: _userProfile.theme,
                                  accent: _userProfile.accent,
                                  visibility: _userProfile.visibility,
                                );
                              });
                            }
                          },
                        ),
                      ],
                    ),
                  ),
                  MinimalNavigationBar(
                    currentIndex: _currentTabIndex,
                    onTabSelected: (index) => setState(() => _currentTabIndex = index),
                    activeTransfersCount: _selectedFiles.length,
                    unreadChatCount: 0,
                  ),
                ],
              ),

              // Active Transfer Stream or Completion Burst Modal (Files ONLY, never for chat messages)
              if (_activeTransferId.isNotEmpty &&
                  _totalTransferBytes > 0 &&
                  (_transferState == TransferState.transferring ||
                   _transferState == TransferState.transferFinished ||
                   _transferState == TransferState.flushing ||
                   _transferState == TransferState.verifying ||
                   _transferState == TransferState.completed ||
                   _transferState == TransferState.failed))
                _buildTransferOverlay(theme),
            ],
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // HEADER
  // ---------------------------------------------------------------------------
  Widget _buildHeader(AuraTheme theme) {
    String visText = 'Everyone';
    if (_visibilityMode == VisibilityMode.receivingOff) visText = 'Off';
    if (_visibilityMode == VisibilityMode.contactsOnly) visText = 'Contacts';
    if (_visibilityMode == VisibilityMode.temporaryEveryone) {
      visText =
          '${_temporarySecondsRemaining ~/ 60}:${(_temporarySecondsRemaining % 60).toString().padLeft(2, '0')}';
    }

    final hasAvatar =
        _userProfile.avatarPath.isNotEmpty && File(_userProfile.avatarPath).existsSync();

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      decoration: BoxDecoration(
        color: theme.background,
        border: Border(bottom: BorderSide(color: theme.border, width: 1.0)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              Text(
                'AuraDrop',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                  color: theme.textPrimary,
                  letterSpacing: -0.5,
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: theme.subtleHighlight,
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: theme.border, width: 0.8),
                ),
                child: Text(
                  'v6.0',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: theme.textSecondary,
                  ),
                ),
              ),
            ],
          ),
          Row(
            children: [
              // Visibility Mode Pill
              GestureDetector(
                onTap: () {
                  final modes = VisibilityMode.values;
                  final nextIdx = (_visibilityMode.index + 1) % modes.length;
                  _applyVisibilityMode(modes[nextIdx]);
                },
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: theme.cardBackground,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: theme.border, width: 0.8),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 6,
                        height: 6,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: _visibilityMode != VisibilityMode.receivingOff
                              ? theme.textPrimary
                              : theme.textSecondary,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        visText,
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: theme.textPrimary,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              // Settings Button
              MinimalIconButton(
                icon: Icons.tune_rounded,
                size: 32,
                onPressed: () {
                  HapticFeedback.lightImpact();
                  showModalBottomSheet(
                    context: context,
                    isScrollControlled: true,
                    backgroundColor: Colors.transparent,
                    builder: (ctx) => Container(
                      height: MediaQuery.of(context).size.height * 0.85,
                      decoration: BoxDecoration(
                        color: theme.cardBackground,
                        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
                        border: Border.all(color: theme.border, width: 1.0),
                      ),
                      child: SettingsScreen(
                        currentVisibility: _visibilityMode,
                        onVisibilityChanged: _applyVisibilityMode,
                        temporarySecondsRemaining: _temporarySecondsRemaining,
                        accentColor: theme.textPrimary,
                        animationSettings: _animationSettings,
                        onAnimationSettingsChanged: (s) =>
                            setState(() => _animationSettings = s),
                        currentThemeMode: widget.currentThemeMode,
                        onThemeModeChanged: widget.onThemeModeChanged,
                      ),
                    ),
                  );
                },
              ),
              const SizedBox(width: 8),

              // Profile Avatar Button
              GestureDetector(
                onTap: () => setState(() => _currentTabIndex = 4),
                child: Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: theme.cardBackground,
                    border: Border.all(color: theme.border, width: 1.0),
                  ),
                  child: hasAvatar
                      ? ClipOval(
                          child: Image.file(
                            File(_userProfile.avatarPath),
                            width: 32,
                            height: 32,
                            fit: BoxFit.cover,
                          ),
                        )
                      : Center(
                          child: Text(
                            _deviceName.isNotEmpty
                                ? _deviceName.substring(0, 1).toUpperCase()
                                : 'A',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w800,
                              color: theme.textPrimary,
                            ),
                          ),
                        ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // HOME SCREEN (HERO GLOBE + DISCOVERY + SHARE TRAY)
  // ---------------------------------------------------------------------------
  Widget _buildHomeScreen(AuraTheme theme) {
    final peerList = _peers.values.toList();
    final screenWidth = MediaQuery.of(context).size.width;
    final screenHeight = MediaQuery.of(context).size.height;
    final globeSize = math.min(screenWidth * 0.74, screenHeight * 0.35);

    return Column(
      children: [
        // Status bar
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
          child: Row(
            children: [
              Container(
                width: 6,
                height: 6,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: _isDiscovering ? theme.textPrimary : theme.textSecondary,
                ),
              ),
              const SizedBox(width: 8),
              Text(
                _visibilityMode == VisibilityMode.receivingOff
                    ? 'Visibility is turned off'
                    : (_peers.isEmpty
                        ? '0 nearby devices'
                        : (_peers.length == 1
                            ? '1 nearby device discovered'
                            : '${_peers.length} nearby devices discovered')),
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: theme.textSecondary,
                ),
              ),
              const Spacer(),
              if (_isDiscovering)
                GestureDetector(
                  onTap: () => _applyVisibilityMode(_visibilityMode),
                  child: Icon(Icons.refresh_rounded, size: 16, color: theme.textSecondary),
                ),
            ],
          ),
        ),

        // Globe Center Visualizer - Vertically and horizontally centered
        Expanded(
          child: Center(
            child: SingleChildScrollView(
              physics: const BouncingScrollPhysics(),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  HeroGlobe(
                    peers: _peers,
                    selectedPeerId: _selectedPeer?.id,
                    onPeerSelected: (peer) {
                      HapticFeedback.selectionClick();
                      setState(() {
                        _selectedPeer = _selectedPeer?.id == peer.id ? null : peer;
                      });
                    },
                    isTransferring: _transferState.isActive,
                    size: globeSize,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Drag globe to rotate • Tap device node to select',
                    style: TextStyle(
                      fontSize: 11,
                      color: theme.textSecondary.withValues(alpha: 0.7),
                    ),
                  ),
                  const SizedBox(height: 14),

                  // Selected Peer Card or Nearby List
                  if (_selectedPeer != null)
                    _buildSelectedPeerCard(_selectedPeer!, theme)
                  else if (peerList.isNotEmpty)
                    _buildNearbyPeerChips(peerList, theme)
                  else
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 8),
                      child: Text(
                        'No devices found yet. Ensure Wi-Fi is on and nearby devices have AuraDrop open.',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 11, color: theme.textSecondary, height: 1.4),
                      ),
                    ),
                  const SizedBox(height: 10),
                ],
              ),
            ),
          ),
        ),

        // Docked Share Tray
        _buildDockedShareTray(theme),
      ],
    );
  }

  Widget _buildSelectedPeerCard(PeerDevice peer, AuraTheme theme) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: MinimalCard(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            MinimalPeerAvatar(peer: peer, size: 44, isSelected: true),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    peer.name,
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: theme.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${peer.deviceName} • ${peer.connectionState.toUpperCase()} • ${peer.transport}',
                    style: TextStyle(fontSize: 11, color: theme.textSecondary),
                  ),
                ],
              ),
            ),
            MinimalIconButton(
              icon: Icons.chat_bubble_outline_rounded,
              size: 36,
              onPressed: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => ChatScreen(peer: peer)),
                );
              },
            ),
            const SizedBox(width: 8),
            MinimalButton(
              text: _selectedFiles.isNotEmpty ? 'Send (${_selectedFiles.length})' : 'Send',
              icon: Icons.arrow_upward_rounded,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              onPressed: () => _sendFilesToPeer(peer),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildNearbyPeerChips(List<PeerDevice> peers, AuraTheme theme) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Nearby Devices',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              color: theme.textSecondary,
              letterSpacing: 0.4,
            ),
          ),
          const SizedBox(height: 8),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            physics: const BouncingScrollPhysics(),
            child: Row(
              children: peers.map((p) {
                final isSelected = _selectedPeer?.id == p.id;
                return GestureDetector(
                  onTap: () {
                    HapticFeedback.selectionClick();
                    setState(() => _selectedPeer = isSelected ? null : p);
                  },
                  child: Container(
                    margin: const EdgeInsets.only(right: 8),
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: isSelected ? theme.actionBackground : theme.cardBackground,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: isSelected ? theme.actionBackground : theme.border,
                        width: 1.0,
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        MinimalPeerAvatar(peer: p, size: 28, isSelected: isSelected),
                        const SizedBox(width: 8),
                        Text(
                          p.name,
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: isSelected ? theme.actionText : theme.textPrimary,
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              }).toList(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDockedShareTray(AuraTheme theme) {
    final count = _selectedFiles.length;
    final totalSize = _selectedFiles.fold(0, (acc, f) => acc + f.size);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      decoration: BoxDecoration(
        color: theme.background,
        border: Border(top: BorderSide(color: theme.border, width: 1.0)),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: theme.cardBackground,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: theme.border, width: 0.8),
            ),
            child: Icon(Icons.attach_file_rounded, color: theme.textPrimary, size: 18),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  count > 0 ? '$count file(s) staged' : 'Ready to share',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: theme.textPrimary,
                  ),
                ),
                Text(
                  count > 0 ? _formatBytes(totalSize) : 'Tap "+ Add" to choose files',
                  style: TextStyle(fontSize: 11, color: theme.textSecondary),
                ),
              ],
            ),
          ),
          if (count > 0) ...[
            TextButton(
              onPressed: () {
                HapticFeedback.lightImpact();
                setState(() => _selectedFiles.clear());
              },
              child: Text(
                'Clear',
                style: TextStyle(fontSize: 12, color: theme.textSecondary),
              ),
            ),
            const SizedBox(width: 4),
          ],
          MinimalButton(
            text: 'Add',
            icon: Icons.add_rounded,
            isPrimary: _selectedPeer == null || count == 0,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            onPressed: _pickFiles,
          ),
          if (_selectedPeer != null && count > 0) ...[
            const SizedBox(width: 8),
            MinimalButton(
              text: 'Send',
              icon: Icons.arrow_upward_rounded,
              isPrimary: true,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              onPressed: () => _sendFilesToPeer(_selectedPeer!),
            ),
          ],
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // TRANSFER OVERLAY (DATA STREAM OR COMPLETION MODAL)
  // ---------------------------------------------------------------------------
  Widget _buildTransferOverlay(AuraTheme theme) {
    return Container(
      color: Colors.black.withValues(alpha: 0.85),
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: Center(
        child: _transferState == TransferState.completed ||
                _transferState == TransferState.failed
            ? AuraCompletionModal(
                isSuccess: _transferState == TransferState.completed,
                fileName: _activeFileName,
                fileSize: _totalTransferBytes,
                sha256: _lastSha256,
                localPath: _lastSavedPath,
                errorMessage: _lastErrorMessage,
                accentColor: theme.textPrimary,
                onOpen: () async {
                  if (_lastSavedPath.isNotEmpty) {
                    await NativeBridgeService.openFile(_lastSavedPath);
                  }
                  setState(() {
                    _transferState = TransferState.idle;
                    _selectedFiles.clear();
                  });
                },
                onShare: () async {
                  if (_lastSavedPath.isNotEmpty) {
                    await NativeBridgeService.openFile(_lastSavedPath);
                  }
                },
                onDismiss: () {
                  setState(() {
                    _transferState = TransferState.idle;
                    _selectedFiles.clear();
                  });
                },
                onRetry: _isSender && _activePeer != null
                    ? () => _sendFilesToPeer(_activePeer!)
                    : null,
              )
            : AuraDataStreamVisualizer(
                transferredBytes: _transferredBytes,
                totalBytes: _totalTransferBytes,
                speedBytesPerSec: _speedBytesPerSec,
                fileName: _activeFileName,
                accentColor: theme.textPrimary,
                isSending: _isSender,
                onCancel: _cancelTransfer,
              ),
      ),
    );
  }
}
