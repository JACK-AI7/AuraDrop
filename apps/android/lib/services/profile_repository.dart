import 'dart:async';
import '../models/models.dart';
import 'native_bridge.dart';

class ProfileRepository {
  static final ProfileRepository _instance = ProfileRepository._internal();
  factory ProfileRepository() => _instance;
  ProfileRepository._internal();

  UserProfile? _cachedProfile;

  UserProfile? get cachedProfile => _cachedProfile;

  Future<UserProfile> loadProfile() async {
    final profile = await NativeBridgeService.getUserProfile();
    _cachedProfile = profile;
    return profile;
  }

  /// Atomically saves [key] and [value], reads back the profile from SQLite,
  /// and confirms that the persisted value matches before returning success.
  Future<bool> saveAndVerify(String key, String value) async {
    try {
      await NativeBridgeService.saveUserProfile(key, value);

      // Verify read-back from SQLite
      final verified = await NativeBridgeService.getUserProfile();
      _cachedProfile = verified;

      switch (key) {
        case 'display_name':
          return verified.displayName == value;
        case 'device_name':
          return verified.deviceName == value;
        case 'bio':
          return verified.bio == value;
        case 'theme':
          return verified.theme == value;
        case 'visibility':
          return verified.visibility.toLowerCase() == value.toLowerCase();
        case 'avatar_index':
          return verified.avatarIndex.toString() == value;
        case 'avatar_path':
          return verified.avatarPath == value;
        default:
          return true;
      }
    } catch (e) {
      return false;
    }
  }

  Future<bool> updateDisplayName(String name) async {
    final trimmed = name.trim();
    if (trimmed.isEmpty) return false;
    return await saveAndVerify('display_name', trimmed);
  }

  Future<bool> updateDeviceName(String name) async {
    final trimmed = name.trim();
    if (trimmed.isEmpty) return false;
    return await saveAndVerify('device_name', trimmed);
  }

  Future<bool> updateBio(String bio) async {
    return await saveAndVerify('bio', bio.trim());
  }

  Future<bool> updateTheme(String theme) async {
    return await saveAndVerify('theme', theme);
  }

  Future<bool> updateVisibility(String visibility) async {
    final ok = await saveAndVerify('visibility', visibility);
    if (ok) {
      await NativeBridgeService.updateVisibilityMode(visibility);
    }
    return ok;
  }

  Future<bool> updateAvatarIndex(int index) async {
    return await saveAndVerify('avatar_index', index.toString());
  }

  Future<bool> updateAvatarPath(String path) async {
    return await saveAndVerify('avatar_path', path);
  }

  Future<bool> removeAvatar() async {
    final ok = await NativeBridgeService.removeAvatarImage();
    if (ok) {
      await loadProfile();
    }
    return ok;
  }
}
