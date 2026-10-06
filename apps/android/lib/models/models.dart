enum TransferState {
  idle,
  discovering,
  peerFound,
  pairing,
  waitingForAccept,
  connecting,
  preparing,
  transferring,
  paused,
  resuming,
  verifying,
  completed,
  failed,
  cancelled,
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
  final String platform;
  final String ip;
  final int port;
  final DateTime lastSeen;
  final bool isTrusted;
  final int avatarIndex;

  PeerDevice({
    required this.id,
    required this.name,
    required this.platform,
    required this.ip,
    required this.port,
    required this.lastSeen,
    this.isTrusted = false,
    this.avatarIndex = 0,
  });

  factory PeerDevice.fromMap(Map<dynamic, dynamic> map, {bool isTrusted = false}) {
    return PeerDevice(
      id: map['id']?.toString() ?? '',
      name: map['name']?.toString() ?? 'Nearby Peer',
      platform: map['platform']?.toString() ?? 'android',
      ip: map['ip']?.toString() ?? '127.0.0.1',
      port: (map['port'] as num?)?.toInt() ?? 48291,
      lastSeen: DateTime.now(),
      isTrusted: isTrusted,
      avatarIndex: (map['name']?.toString().hashCode ?? 0).abs() % 6,
    );
  }

  PeerDevice copyWith({bool? isTrusted, int? avatarIndex}) {
    return PeerDevice(
      id: id,
      name: name,
      platform: platform,
      ip: ip,
      port: port,
      lastSeen: lastSeen,
      isTrusted: isTrusted ?? this.isTrusted,
      avatarIndex: avatarIndex ?? this.avatarIndex,
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

  ChatMessage({
    required this.id,
    required this.peerId,
    required this.peerName,
    required this.senderId,
    required this.text,
    required this.timestamp,
    required this.status,
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
  final int avatarIndex;
  final String bio;
  final String theme;
  final String accent;
  final String visibility;

  UserProfile({
    required this.displayName,
    required this.avatarIndex,
    required this.bio,
    required this.theme,
    required this.accent,
    required this.visibility,
  });

  factory UserProfile.fromMap(Map<dynamic, dynamic> map) {
    return UserProfile(
      displayName: map['display_name']?.toString() ?? 'AuraDrop User',
      avatarIndex: int.tryParse(map['avatar_index']?.toString() ?? '0') ?? 0,
      bio: map['bio']?.toString() ?? 'Nearby sharing made effortless',
      theme: map['theme']?.toString() ?? 'glass_dark',
      accent: map['accent']?.toString() ?? 'cyan',
      visibility: map['visibility']?.toString() ?? 'everyone',
    );
  }
}
