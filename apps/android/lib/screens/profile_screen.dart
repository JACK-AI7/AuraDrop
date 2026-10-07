import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../models/models.dart';
import '../services/native_bridge.dart';
import '../services/profile_repository.dart';
import '../theme/aura_theme.dart';
import '../components/minimal_components.dart';

class ProfileScreen extends StatefulWidget {
  final UserProfile profile;
  final Function(String, String) onProfileUpdated;

  const ProfileScreen({
    super.key,
    required this.profile,
    required this.onProfileUpdated,
  });

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  late TextEditingController _nameController;
  late TextEditingController _deviceNameController;
  late TextEditingController _bioController;
  late String _selectedTheme;
  late String _avatarPath;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.profile.displayName);
    _deviceNameController = TextEditingController(text: widget.profile.deviceName);
    _bioController = TextEditingController(text: widget.profile.bio);
    _selectedTheme = widget.profile.theme;
    _avatarPath = widget.profile.avatarPath;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _deviceNameController.dispose();
    _bioController.dispose();
    super.dispose();
  }

  void _showAvatarOptionsSheet(AuraTheme theme) {
    HapticFeedback.lightImpact();
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: theme.cardBackground,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
            border: Border.all(color: theme.border, width: 1.0),
          ),
          child: SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Profile Photo',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: theme.textPrimary),
                ),
                const SizedBox(height: 4),
                Text(
                  'Broadcast to nearby devices on the globe.',
                  style: TextStyle(fontSize: 12, color: theme.textSecondary),
                ),
                const SizedBox(height: 20),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: theme.subtleHighlight,
                      border: Border.all(color: theme.border, width: 1.0),
                    ),
                    child: Icon(Icons.photo_library_outlined, color: theme.textPrimary, size: 18),
                  ),
                  title: Text('Choose from Gallery', style: TextStyle(color: theme.textPrimary, fontWeight: FontWeight.w600, fontSize: 14)),
                  subtitle: Text('Select an image from local storage', style: TextStyle(color: theme.textSecondary, fontSize: 12)),
                  onTap: () async {
                    Navigator.pop(ctx);
                    final path = await NativeBridgeService.pickAvatarImage();
                    if (path != null && path.isNotEmpty) {
                      setState(() => _avatarPath = path);
                      await NativeBridgeService.saveUserProfile('avatar_path', path);
                      widget.onProfileUpdated('avatar_path', path);
                    }
                  },
                ),
                if (_avatarPath.isNotEmpty)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: theme.subtleHighlight,
                        border: Border.all(color: theme.border, width: 1.0),
                      ),
                      child: Icon(Icons.delete_outline, color: theme.error, size: 18),
                    ),
                    title: Text('Remove Photo', style: TextStyle(color: theme.error, fontWeight: FontWeight.w600, fontSize: 14)),
                    subtitle: Text('Use clean initials instead', style: TextStyle(color: theme.textSecondary, fontSize: 12)),
                    onTap: () async {
                      Navigator.pop(ctx);
                      await NativeBridgeService.removeAvatarImage();
                      setState(() => _avatarPath = '');
                      await NativeBridgeService.saveUserProfile('avatar_path', '');
                      widget.onProfileUpdated('avatar_path', '');
                    },
                  ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _saveProfile() async {
    HapticFeedback.mediumImpact();
    final name = _nameController.text.trim();
    final devName = _deviceNameController.text.trim();
    final bio = _bioController.text.trim();

    final finalDevName = devName.isNotEmpty ? devName : 'Unknown Device';
    final finalName = name.isNotEmpty ? name : finalDevName;

    final repo = ProfileRepository();
    final ok1 = await repo.updateDisplayName(finalName);
    final ok2 = await repo.updateDeviceName(finalDevName);
    final ok3 = await repo.updateBio(bio);
    final ok4 = await repo.updateTheme(_selectedTheme);

    widget.onProfileUpdated('display_name', finalName);
    widget.onProfileUpdated('device_name', finalDevName);
    widget.onProfileUpdated('theme', _selectedTheme);

    final success = ok1 && ok2 && ok3 && ok4;
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(success ? 'Profile saved and verified' : 'Saved with warnings'),
          backgroundColor: Colors.black87,
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = AuraTheme.of(context);
    final hasCustomAvatar = _avatarPath.isNotEmpty && File(_avatarPath).existsSync();

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 110),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Profile & Identity',
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.w800,
              color: theme.textPrimary,
              letterSpacing: -0.5,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Visible to nearby devices on the discovery globe.',
            style: TextStyle(fontSize: 12, color: theme.textSecondary),
          ),
          const SizedBox(height: 24),

          // Center Profile Hero
          Center(
            child: Column(
              children: [
                GestureDetector(
                  onTap: () => _showAvatarOptionsSheet(theme),
                  behavior: HitTestBehavior.opaque,
                  child: Stack(
                    children: [
                      Container(
                        width: 80,
                        height: 80,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: theme.cardBackground,
                          border: Border.all(color: theme.border, width: 1.5),
                        ),
                        child: hasCustomAvatar
                            ? ClipOval(
                                child: Image.file(
                                  File(_avatarPath),
                                  width: 80,
                                  height: 80,
                                  fit: BoxFit.cover,
                                ),
                              )
                            : Center(
                                child: Text(
                                  _nameController.text.isNotEmpty ? _nameController.text.substring(0, 1).toUpperCase() : 'A',
                                  style: TextStyle(
                                    fontSize: 32,
                                    fontWeight: FontWeight.w800,
                                    color: theme.textPrimary,
                                  ),
                                ),
                              ),
                      ),
                      Positioned(
                        right: 0,
                        bottom: 0,
                        child: Container(
                          width: 24,
                          height: 24,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: theme.actionBackground,
                            border: Border.all(color: theme.background, width: 2.0),
                          ),
                          child: Center(
                            child: Icon(
                              Icons.edit_outlined,
                              size: 11,
                              color: theme.actionText,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  _nameController.text.isNotEmpty
                      ? _nameController.text
                      : (_deviceNameController.text.isNotEmpty
                          ? _deviceNameController.text
                          : 'Unknown Device'),
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                    color: theme.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  _deviceNameController.text.isNotEmpty ? _deviceNameController.text : 'Unknown Device',
                  style: TextStyle(
                    fontSize: 12,
                    color: theme.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 28),

          // Fields
          _buildFieldLabel('Display Name', theme),
          const SizedBox(height: 6),
          _buildTextField(_nameController, 'Enter display name', theme),
          const SizedBox(height: 16),

          _buildFieldLabel('Device Name', theme),
          const SizedBox(height: 6),
          _buildTextField(_deviceNameController, 'e.g. Pixel 8', theme),
          const SizedBox(height: 16),

          _buildFieldLabel('Status / Bio', theme),
          const SizedBox(height: 6),
          _buildTextField(_bioController, 'Short bio', theme),
          const SizedBox(height: 24),

          // Appearance Selector (System / Light / Dark)
          _buildFieldLabel('Appearance', theme),
          const SizedBox(height: 10),
          Row(
            children: [
              _buildThemeOption('system', 'System', Icons.settings_brightness_rounded, theme),
              const SizedBox(width: 8),
              _buildThemeOption('light', 'Light', Icons.wb_sunny_outlined, theme),
              const SizedBox(width: 8),
              _buildThemeOption('dark', 'Dark', Icons.nightlight_round, theme),
            ],
          ),
          const SizedBox(height: 32),

          SizedBox(
            width: double.infinity,
            child: MinimalButton(
              text: 'Save Profile',
              onPressed: _saveProfile,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFieldLabel(String label, AuraTheme theme) {
    return Text(
      label,
      style: TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w700,
        color: theme.textSecondary,
        letterSpacing: 0.3,
      ),
    );
  }

  Widget _buildTextField(TextEditingController controller, String hint, AuraTheme theme) {
    return Container(
      decoration: BoxDecoration(
        color: theme.cardBackground,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.border, width: 1.0),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 14),
      child: TextField(
        controller: controller,
        style: TextStyle(color: theme.textPrimary, fontSize: 14),
        decoration: InputDecoration(
          border: InputBorder.none,
          hintText: hint,
          hintStyle: TextStyle(color: theme.textSecondary, fontSize: 13),
          isDense: true,
          contentPadding: const EdgeInsets.symmetric(vertical: 12),
        ),
      ),
    );
  }

  Widget _buildThemeOption(String id, String label, IconData icon, AuraTheme theme) {
    final isSelected = _selectedTheme == id || (_selectedTheme.contains('light') && id == 'light') || (!_selectedTheme.contains('light') && id == 'dark' && _selectedTheme != 'system');

    return Expanded(
      child: GestureDetector(
        onTap: () {
          HapticFeedback.selectionClick();
          setState(() => _selectedTheme = id);
        },
        behavior: HitTestBehavior.opaque,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            color: isSelected ? theme.actionBackground : theme.cardBackground,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: isSelected ? theme.actionBackground : theme.border,
              width: 1.0,
            ),
          ),
          child: Column(
            children: [
              Icon(
                icon,
                size: 18,
                color: isSelected ? theme.actionText : theme.textPrimary,
              ),
              const SizedBox(height: 6),
              Text(
                label,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: isSelected ? theme.actionText : theme.textPrimary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
