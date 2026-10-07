import 'dart:convert';
import 'dart:typed_data';

class AuraProtocol {
  static const int headerSize = 20;
  static const int magicP = 0x50; // 'P'
  static const int magic2 = 0x32; // '2'
  static const int magicP2 = 0x50; // 'P'
  static const int magicF = 0x46; // 'F'
  static const int protocolVersion = 0x01;

  // Frame Types
  static const int frameHandshakeInit = 0x01;
  static const int frameHandshakeResp = 0x02;
  static const int frameHealthPing = 0x03;
  static const int frameHealthPong = 0x04;
  static const int frameNegotiationReq = 0x10; // Transfer request
  static const int frameNegotiationResp = 0x11; // Transfer accept/decline
  static const int frameFileStart = 0x20;
  static const int frameChunkData = 0x21;
  static const int frameFileFin = 0x22;
  static const int frameAckComplete = 0x23;
  static const int frameCancel = 0x24;
  static const int frameResume = 0x25;
  static const int frameError = 0x26;
  static const int frameChatMessage = 0x30;
  static const int frameChatAck = 0x31;
  static const int frameChatTyping = 0x32;

  // Flags
  static const int flagJson = 0x0001;
  static const int flagEncrypted = 0x0002;
  static const int flagLastChunk = 0x0010;

  static Uint8List buildFrame(
    int frameType,
    Uint8List payload, {
    int flags = 0,
    int sequenceNumber = 0,
  }) {
    final header = ByteData(headerSize);
    header.setUint8(0, magicP);
    header.setUint8(1, magic2);
    header.setUint8(2, magicP2);
    header.setUint8(3, magicF);
    header.setUint8(4, protocolVersion);
    header.setUint8(5, frameType);
    header.setUint16(6, flags, Endian.big);
    header.setUint32(8, payload.length, Endian.big);
    header.setUint64(12, sequenceNumber, Endian.big);

    final total = Uint8List(headerSize + payload.length);
    total.setRange(0, headerSize, header.buffer.asUint8List());
    total.setRange(headerSize, headerSize + payload.length, payload);
    return total;
  }

  static Uint8List buildJsonFrame(
    int frameType,
    Map<String, dynamic> jsonMap, {
    int flags = flagJson,
    int sequenceNumber = 0,
  }) {
    final jsonBytes = utf8.encode(jsonEncode(jsonMap));
    return buildFrame(
      frameType,
      Uint8List.fromList(jsonBytes),
      flags: flags | flagJson,
      sequenceNumber: sequenceNumber,
    );
  }

  static DecodedAuraFrame? decodeFrame(Uint8List bytes) {
    if (bytes.length < headerSize) return null;
    if (bytes[0] != magicP ||
        bytes[1] != magic2 ||
        bytes[2] != magicP2 ||
        bytes[3] != magicF) {
      return null;
    }

    final bd = ByteData.sublistView(bytes);
    final version = bd.getUint8(4);
    final frameType = bd.getUint8(5);
    final flags = bd.getUint16(6, Endian.big);
    final payloadLen = bd.getUint32(8, Endian.big);
    final sequenceNumber = bd.getUint64(12, Endian.big);

    if (bytes.length < headerSize + payloadLen) return null;

    final payload = Uint8List.sublistView(bytes, headerSize, headerSize + payloadLen);

    return DecodedAuraFrame(
      version: version,
      frameType: frameType,
      flags: flags,
      payloadLength: payloadLen,
      sequenceNumber: sequenceNumber,
      payload: payload,
    );
  }
}

class DecodedAuraFrame {
  final int version;
  final int frameType;
  final int flags;
  final int payloadLength;
  final int sequenceNumber;
  final Uint8List payload;

  DecodedAuraFrame({
    required this.version,
    required this.frameType,
    required this.flags,
    required this.payloadLength,
    required this.sequenceNumber,
    required this.payload,
  });

  bool get isJson => (flags & AuraProtocol.flagJson) != 0;

  Map<String, dynamic>? asJson() {
    try {
      final str = utf8.decode(payload);
      final decoded = jsonDecode(str);
      if (decoded is Map<String, dynamic>) return decoded;
      if (decoded is Map) return Map<String, dynamic>.from(decoded);
      return null;
    } catch (_) {
      return null;
    }
  }
}
