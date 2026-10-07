enum TransferState {
  idle,
  discovering,
  peerFound,
  pairing,
  queued,
  preparing,
  connecting,
  waitingForAccept,
  transferring,
  transferFinished,
  flushing,
  verifying,
  databaseCommit,
  completed,
  failed,
  cancelled,
  interrupted,
  paused,
  resuming;

  static TransferState fromString(String? state) {
    if (state == null) return TransferState.idle;
    switch (state.toUpperCase()) {
      case 'IDLE':
        return TransferState.idle;
      case 'DISCOVERING':
        return TransferState.discovering;
      case 'PEER_FOUND':
      case 'PEERFOUND':
        return TransferState.peerFound;
      case 'PAIRING':
        return TransferState.pairing;
      case 'QUEUED':
        return TransferState.queued;
      case 'PREPARING':
        return TransferState.preparing;
      case 'CONNECTING':
        return TransferState.connecting;
      case 'WAITING_FOR_ACCEPTANCE':
      case 'WAITINGFORACCEPT':
      case 'WAITING_FOR_ACCEPT':
        return TransferState.waitingForAccept;
      case 'TRANSFERRING':
        return TransferState.transferring;
      case 'TRANSFER_FINISHED':
      case 'TRANSFERFINISHED':
        return TransferState.transferFinished;
      case 'FLUSHING':
        return TransferState.flushing;
      case 'VERIFYING':
        return TransferState.verifying;
      case 'DATABASE_COMMIT':
      case 'DATABASECOMMIT':
        return TransferState.databaseCommit;
      case 'COMPLETED':
        return TransferState.completed;
      case 'FAILED':
        return TransferState.failed;
      case 'CANCELLED':
      case 'CANCELED':
        return TransferState.cancelled;
      case 'INTERRUPTED':
        return TransferState.interrupted;
      case 'PAUSED':
        return TransferState.paused;
      case 'RESUMING':
        return TransferState.resuming;
      default:
        return TransferState.idle;
    }
  }

  bool get isActive =>
      this == TransferState.queued ||
      this == TransferState.preparing ||
      this == TransferState.connecting ||
      this == TransferState.waitingForAccept ||
      this == TransferState.transferring ||
      this == TransferState.transferFinished ||
      this == TransferState.flushing ||
      this == TransferState.verifying ||
      this == TransferState.databaseCommit ||
      this == TransferState.resuming;

  bool get isDone =>
      this == TransferState.completed ||
      this == TransferState.failed ||
      this == TransferState.cancelled ||
      this == TransferState.interrupted;

  String get label {
    switch (this) {
      case TransferState.idle:
        return 'Ready';
      case TransferState.discovering:
        return 'Searching nearby...';
      case TransferState.peerFound:
        return 'Peer Found';
      case TransferState.pairing:
        return 'Pairing...';
      case TransferState.queued:
        return 'Queued';
      case TransferState.preparing:
        return 'Preparing payload...';
      case TransferState.connecting:
        return 'Establishing socket...';
      case TransferState.waitingForAccept:
        return 'Waiting for receiver...';
      case TransferState.transferring:
        return 'Transferring...';
      case TransferState.transferFinished:
        return 'Payload received';
      case TransferState.flushing:
        return 'Flushing to storage...';
      case TransferState.verifying:
        return 'Verifying SHA-256...';
      case TransferState.databaseCommit:
        return 'Finalizing transfer...';
      case TransferState.completed:
        return 'Completed';
      case TransferState.failed:
        return 'Transfer failed';
      case TransferState.cancelled:
        return 'Cancelled';
      case TransferState.interrupted:
        return 'Interrupted';
      case TransferState.paused:
        return 'Paused';
      case TransferState.resuming:
        return 'Resuming...';
    }
  }
}

enum VisibilityMode {
  receivingOff,
  contactsOnly,
  everyoneNearby,
  temporaryEveryone,
}

enum AnimationQuality {
  minimal,
  balanced,
  immersive,
}

class AnimationSettings {
  final AnimationQuality quality;
  final bool enableProximityRipple;
  final bool enableWarpField;
  final bool enableParticles;
  final bool enableGlassMotion;
  final bool enableCompletionBurst;
  final bool enableBackgroundAnimation;
  final bool reducedMotion;

  const AnimationSettings({
    this.quality = AnimationQuality.balanced,
    this.enableProximityRipple = true,
    this.enableWarpField = true,
    this.enableParticles = true,
    this.enableGlassMotion = true,
    this.enableCompletionBurst = true,
    this.enableBackgroundAnimation = true,
    this.reducedMotion = false,
  });

  AnimationSettings copyWith({
    AnimationQuality? quality,
    bool? enableProximityRipple,
    bool? enableWarpField,
    bool? enableParticles,
    bool? enableGlassMotion,
    bool? enableCompletionBurst,
    bool? enableBackgroundAnimation,
    bool? reducedMotion,
  }) {
    return AnimationSettings(
      quality: quality ?? this.quality,
      enableProximityRipple: enableProximityRipple ?? this.enableProximityRipple,
      enableWarpField: enableWarpField ?? this.enableWarpField,
      enableParticles: enableParticles ?? this.enableParticles,
      enableGlassMotion: enableGlassMotion ?? this.enableGlassMotion,
      enableCompletionBurst: enableCompletionBurst ?? this.enableCompletionBurst,
      enableBackgroundAnimation: enableBackgroundAnimation ?? this.enableBackgroundAnimation,
      reducedMotion: reducedMotion ?? this.reducedMotion,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'quality': quality.name,
      'enableProximityRipple': enableProximityRipple,
      'enableWarpField': enableWarpField,
      'enableParticles': enableParticles,
      'enableGlassMotion': enableGlassMotion,
      'enableCompletionBurst': enableCompletionBurst,
      'enableBackgroundAnimation': enableBackgroundAnimation,
      'reducedMotion': reducedMotion,
    };
  }

  factory AnimationSettings.fromMap(Map<dynamic, dynamic>? map) {
    if (map == null) return const AnimationSettings();
    final qStr = map['quality']?.toString() ?? 'balanced';
    final q = AnimationQuality.values.firstWhere(
      (e) => e.name == qStr,
      orElse: () => AnimationQuality.balanced,
    );
    return AnimationSettings(
      quality: q,
      enableProximityRipple: map['enableProximityRipple'] as bool? ?? true,
      enableWarpField: map['enableWarpField'] as bool? ?? true,
      enableParticles: map['enableParticles'] as bool? ?? true,
      enableGlassMotion: map['enableGlassMotion'] as bool? ?? true,
      enableCompletionBurst: map['enableCompletionBurst'] as bool? ?? true,
      enableBackgroundAnimation: map['enableBackgroundAnimation'] as bool? ?? true,
      reducedMotion: map['reducedMotion'] as bool? ?? false,
    );
  }
}

class TransferMetrics {
  final double currentSpeedMBps;
  final double peakSpeedMBps;
  final double avgSpeedMBps;
  final int connectionTimeMs;
  final int handshakeTimeMs;
  final int firstByteTimeMs;
  final double diskWriteMBps;
  final int ramUsageMB;
  final int cpuPercent;

  const TransferMetrics({
    this.currentSpeedMBps = 0.0,
    this.peakSpeedMBps = 0.0,
    this.avgSpeedMBps = 0.0,
    this.connectionTimeMs = 0,
    this.handshakeTimeMs = 0,
    this.firstByteTimeMs = 0,
    this.diskWriteMBps = 0.0,
    this.ramUsageMB = 0,
    this.cpuPercent = 0,
  });

  TransferMetrics copyWith({
    double? currentSpeedMBps,
    double? peakSpeedMBps,
    double? avgSpeedMBps,
    int? connectionTimeMs,
    int? handshakeTimeMs,
    int? firstByteTimeMs,
    double? diskWriteMBps,
    int? ramUsageMB,
    int? cpuPercent,
  }) {
    return TransferMetrics(
      currentSpeedMBps: currentSpeedMBps ?? this.currentSpeedMBps,
      peakSpeedMBps: peakSpeedMBps ?? this.peakSpeedMBps,
      avgSpeedMBps: avgSpeedMBps ?? this.avgSpeedMBps,
      connectionTimeMs: connectionTimeMs ?? this.connectionTimeMs,
      handshakeTimeMs: handshakeTimeMs ?? this.handshakeTimeMs,
      firstByteTimeMs: firstByteTimeMs ?? this.firstByteTimeMs,
      diskWriteMBps: diskWriteMBps ?? this.diskWriteMBps,
      ramUsageMB: ramUsageMB ?? this.ramUsageMB,
      cpuPercent: cpuPercent ?? this.cpuPercent,
    );
  }
}

class PeerDevice {
  final String id;
  final String name;
  final String deviceName;
  final String platform;
  final String ip;
  final int port;
  final DateTime lastSeen;
  final bool isTrusted;
  final int avatarIndex;
  final String avatarPath;
  final String status;

  PeerDevice({
    required this.id,
    required this.name,
    required this.deviceName,
    required this.platform,
    required this.ip,
    required this.port,
    required this.lastSeen,
    this.isTrusted = false,
    this.avatarIndex = 0,
    this.avatarPath = '',
    this.status = '',
  });

  factory PeerDevice.fromMap(Map<dynamic, dynamic> map, {bool isTrusted = false}) {
    final name = map['name']?.toString() ?? 'Nearby Peer';
    return PeerDevice(
      id: map['id']?.toString() ?? '',
      name: name,
      deviceName: map['deviceName']?.toString() ?? name,
      platform: map['platform']?.toString() ?? 'android',
      ip: map['ip']?.toString() ?? '127.0.0.1',
      port: (map['port'] as num?)?.toInt() ?? 48291,
      lastSeen: DateTime.now(),
      isTrusted: isTrusted,
      avatarIndex: (map['avatarIndex'] as num?)?.toInt() ?? (name.hashCode.abs() % 6),
      avatarPath: map['avatarPath']?.toString() ?? '',
      status: map['status']?.toString() ?? '',
    );
  }

  PeerDevice copyWith({
    bool? isTrusted,
    int? avatarIndex,
    String? avatarPath,
    String? status,
  }) {
    return PeerDevice(
      id: id,
      name: name,
      deviceName: deviceName,
      platform: platform,
      ip: ip,
      port: port,
      lastSeen: lastSeen,
      isTrusted: isTrusted ?? this.isTrusted,
      avatarIndex: avatarIndex ?? this.avatarIndex,
      avatarPath: avatarPath ?? this.avatarPath,
      status: status ?? this.status,
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
  final DateTime timestamp;
  final String senderName;
  final String receiverName;
  final String fileName;
  final String fileType;
  final int fileSize;
  final String direction; // "sent" or "received"
  final String status;    // "completed", "failed", "cancelled"
  final int durationMs;
  final int avgSpeed;
  final String sha256;
  final String localPath;
  final String transportType;
  final bool isAvailable;

  TransferHistoryItem({
    required this.id,
    required this.timestamp,
    required this.senderName,
    required this.receiverName,
    required this.fileName,
    required this.fileType,
    required this.fileSize,
    required this.direction,
    required this.status,
    required this.durationMs,
    required this.avgSpeed,
    required this.sha256,
    required this.localPath,
    required this.transportType,
    this.isAvailable = true,
  });

  factory TransferHistoryItem.fromMap(Map<dynamic, dynamic> map) {
    return TransferHistoryItem(
      id: map['id']?.toString() ?? '',
      timestamp: DateTime.fromMillisecondsSinceEpoch((map['timestamp'] as num?)?.toInt() ?? 0),
      senderName: map['senderName']?.toString() ?? '',
      receiverName: map['receiverName']?.toString() ?? '',
      fileName: map['fileName']?.toString() ?? '',
      fileType: map['fileType']?.toString() ?? '',
      fileSize: (map['fileSize'] as num?)?.toInt() ?? 0,
      direction: map['direction']?.toString() ?? 'received',
      status: map['status']?.toString() ?? 'completed',
      durationMs: (map['durationMs'] as num?)?.toInt() ?? 0,
      avgSpeed: (map['avgSpeed'] as num?)?.toInt() ?? 0,
      sha256: map['sha256']?.toString() ?? '',
      localPath: map['localPath']?.toString() ?? '',
      transportType: map['transportType']?.toString() ?? 'LAN_TCP',
      isAvailable: map['isAvailable'] as bool? ?? true,
    );
  }
}

class ChatMessage {
  final String id;
  final String peerId;
  final String peerName;
  final String senderId;
  final String text;
  final DateTime timestamp;
  final String status; // "sending", "sent", "delivered", "read", "failed"
  final String messageType; // "text" or "file"
  final String? fileName;
  final int? fileSize;

  ChatMessage({
    required this.id,
    required this.peerId,
    required this.peerName,
    required this.senderId,
    required this.text,
    required this.timestamp,
    required this.status,
    this.messageType = 'text',
    this.fileName,
    this.fileSize,
  });

  factory ChatMessage.fromMap(Map<dynamic, dynamic> map) {
    return ChatMessage(
      id: map['id']?.toString() ?? '',
      peerId: map['peerId']?.toString() ?? '',
      peerName: map['peerName']?.toString() ?? '',
      senderId: map['senderId']?.toString() ?? '',
      text: map['text']?.toString() ?? '',
      timestamp: DateTime.fromMillisecondsSinceEpoch((map['timestamp'] as num?)?.toInt() ?? 0),
      status: map['status']?.toString() ?? 'sent',
      messageType: map['messageType']?.toString() ?? 'text',
      fileName: map['fileName']?.toString(),
      fileSize: (map['fileSize'] as num?)?.toInt(),
    );
  }
}

class ReceivedFileItem {
  final String name;
  final String path;
  final int size;
  final DateTime lastModified;
  final String extension;
  final bool isAvailable;

  ReceivedFileItem({
    required this.name,
    required this.path,
    required this.size,
    required this.lastModified,
    required this.extension,
    this.isAvailable = true,
  });

  factory ReceivedFileItem.fromMap(Map<dynamic, dynamic> map) {
    return ReceivedFileItem(
      name: map['name']?.toString() ?? '',
      path: map['path']?.toString() ?? '',
      size: (map['size'] as num?)?.toInt() ?? 0,
      lastModified: DateTime.fromMillisecondsSinceEpoch((map['lastModified'] as num?)?.toInt() ?? 0),
      extension: map['extension']?.toString() ?? '',
      isAvailable: map['isAvailable'] as bool? ?? true,
    );
  }
}

class UserProfile {
  final String displayName;
  final String deviceName;
  final int avatarIndex;
  final String avatarPath;
  final String bio;
  final String theme;
  final String accent;
  final String visibility;

  UserProfile({
    required this.displayName,
    this.deviceName = 'My Device',
    required this.avatarIndex,
    this.avatarPath = '',
    required this.bio,
    required this.theme,
    required this.accent,
    required this.visibility,
  });

  factory UserProfile.fromMap(Map<dynamic, dynamic> map) {
    return UserProfile(
      displayName: map['display_name']?.toString() ?? 'AuraDrop User',
      deviceName: map['device_name']?.toString() ?? 'My Device',
      avatarIndex: int.tryParse(map['avatar_index']?.toString() ?? '0') ?? 0,
      avatarPath: map['avatar_path']?.toString() ?? '',
      bio: map['bio']?.toString() ?? 'Nearby sharing made effortless',
      theme: map['theme']?.toString() ?? 'glass_dark',
      accent: map['accent']?.toString() ?? 'cyan',
      visibility: map['visibility']?.toString() ?? 'everyone',
    );
  }
}

class BlockedPeer {
  final String peerId;
  final String peerName;
  final DateTime blockedSince;

  BlockedPeer({
    required this.peerId,
    required this.peerName,
    required this.blockedSince,
  });

  factory BlockedPeer.fromMap(Map<dynamic, dynamic> map) {
    return BlockedPeer(
      peerId: map['peer_id']?.toString() ?? '',
      peerName: map['peer_name']?.toString() ?? 'Unknown Peer',
      blockedSince: DateTime.fromMillisecondsSinceEpoch(
        (map['blocked_since'] as num?)?.toInt() ?? DateTime.now().millisecondsSinceEpoch,
      ),
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'peer_id': peerId,
      'peer_name': peerName,
      'blocked_since': blockedSince.millisecondsSinceEpoch,
    };
  }
}

