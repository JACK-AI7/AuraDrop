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

  ReceivedFileItem({
    required this.name,
    required this.path,
    required this.size,
    required this.lastModified,
    required this.extension,
  });

  factory ReceivedFileItem.fromMap(Map<dynamic, dynamic> map) {
    return ReceivedFileItem(
      name: map['name']?.toString() ?? '',
      path: map['path']?.toString() ?? '',
      size: (map['size'] as num?)?.toInt() ?? 0,
      lastModified: DateTime.fromMillisecondsSinceEpoch((map['lastModified'] as num?)?.toInt() ?? 0),
      extension: map['extension']?.toString() ?? '',
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
