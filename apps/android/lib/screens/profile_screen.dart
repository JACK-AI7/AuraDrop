import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../models/models.dart';
import '../services/native_bridge.dart';
import '../components/glass_components.dart';

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
  late String _selectedAccent;
  late int _selectedAvatarIndex;
  late String _avatarPath;

  final List<Map<String, String>> _themeOptions = [
    {'id': 'obsidian_minimal', 'name': 'Obsidian Minimal'},
    {'id': 'pure_black', 'name': 'Pure Black'},
    {'id': 'obsidian_glass', 'name': 'Obsidian Glass'},
    {'id': 'aurora_glass', 'name': 'Nordic Slate'},
    {'id': 'crystal_glass', 'name': 'Monochrome Frost'},
    {'id': 'glass_light', 'name': 'Minimal Light'},
  ];

  final List<Map<String, dynamic>> _accentOptions = [
    {'id': 'white', 'name': 'White', 'color': Color(0xFFFFFFFF)},
    {'id': 'slate', 'name': 'Slate', 'color': Color(0xFF94A3B8)},
    {'id': 'emerald', 'name': 'Emerald', 'color': Color(0xFF10B981)},
    {'id': 'cyan', 'name': 'Cyan', 'color': Color(0xFF38BDF8)},
    {'id': 'indigo', 'name': 'Indigo', 'color': Color(0xFF818CF8)},
  ];

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.profile.displayName);
    _deviceNameController = TextEditingController(text: widget.profile.deviceName);
    _bioController = TextEditingController(text: widget.profile.bio);
    _selectedTheme = widget.profile.theme;
    _selectedAccent = widget.profile.accent;
    _selectedAvatarIndex = widget.profile.avatarIndex;
    _avatarPath = widget.profile.avatarPath;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _deviceNameController.dispose();
    _bioController.dispose();
    super.dispose();
  }

  void _showAvatarOptionsSheet() {
    HapticFeedback.lightImpact();
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: const Color(0xFF111114),
            borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
            border: Border.all(color: Colors.white.withValues(alpha: 0.12), width: 0.7),
          ),
          child: SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Profile Photo',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Colors.white),
                ),
                const SizedBox(height: 6),
                const Text(
                  'Your photo is shared with nearby peers on the radar.',
                  style: TextStyle(fontSize: 12, color: Color(0xFF8A8A8A)),
                ),
                const SizedBox(height: 20),
                ListTile(
                  leading: Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Icon(Icons.photo_library_outlined, color: Colors.white, size: 20),
                  ),
                  title: const Text('Choose from Gallery', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
                  subtitle: const Text('Select an image from device storage', style: TextStyle(color: Colors.white54, fontSize: 11)),
                  onTap: () async {
                    Navigator.pop(ctx);
                    final path = await NativeBridgeService.pickAvatarImage();
                    if (path != null && path.isNotEmpty) {
                      setState(() => _avatarPath = path);
                      await NativeBridgeService.saveUserProfile('avatar_path', path);
                      widget.onProfileUpdated('avatar_path', path);
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: const Text('Profile photo updated'),
                            backgroundColor: const Color(0xFF10B981),
                            behavior: SnackBarBehavior.floating,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                          ),
                        );
                      }
                    }
                  },
                ),
                if (_avatarPath.isNotEmpty)
                  ListTile(
                    leading: Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: Colors.red.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Icon(Icons.delete_outline, color: Color(0xFFF87171), size: 20),
                    ),
                    title: const Text('Remove Photo', style: TextStyle(color: Color(0xFFF87171), fontWeight: FontWeight.w600)),
                    subtitle: const Text('Use clean minimalist initials instead', style: TextStyle(color: Colors.white54, fontSize: 11)),
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

    final finalName = name.isNotEmpty ? name : 'AuraDrop User';
    final finalDevName = devName.isNotEmpty ? devName : 'My Device';

    await NativeBridgeService.saveUserProfile('display_name', finalName);
    await NativeBridgeService.saveUserProfile('device_name', finalDevName);
    await NativeBridgeService.saveUserProfile('bio', bio);
    await NativeBridgeService.saveUserProfile('theme', _selectedTheme);
    await NativeBridgeService.saveUserProfile('accent', _selectedAccent);
    await NativeBridgeService.saveUserProfile('avatar_index', _selectedAvatarIndex.toString());

    widget.onProfileUpdated('display_name', finalName);
    widget.onProfileUpdated('device_name', finalDevName);
    widget.onProfileUpdated('theme', _selectedTheme);
    widget.onProfileUpdated('accent', _selectedAccent);

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Profile updated successfully'),
          backgroundColor: const Color(0xFF10B981),
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasCustomAvatar = _avatarPath.isNotEmpty && File(_avatarPath).existsSync();

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Identity & Appearance',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Colors.white, letterSpacing: -0.5),
          ),
          const SizedBox(height: 4),
          const Text(
            'Your identity is shared securely with nearby peers during discovery.',
            style: TextStyle(fontSize: 12, color: Color(0xFF8A8A8A)),
          ),
          const SizedBox(height: 20),

          // Minimalist Luxury Profile Card
          GlassCard(
            padding: const EdgeInsets.all(18),
            child: Row(
              children: [
                GestureDetector(
                  onTap: _showAvatarOptionsSheet,
                  child: Stack(
                    children: [
                      Container(
                        width: 72,
                        height: 72,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: Colors.white.withValues(alpha: 0.08),
                          border: Border.all(color: Colors.white.withValues(alpha: 0.25), width: 1.0),
                        ),
                        child: hasCustomAvatar
                            ? ClipOval(
                                child: Image.file(
                                  File(_avatarPath),
                                  width: 72,
                                  height: 72,
                                  fit: BoxFit.cover,
                                ),
                              )
                            : Center(
                                child: Text(
                                  _nameController.text.isNotEmpty ? _nameController.text.substring(0, 1).toUpperCase() : 'A',
                                  style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: Colors.white),
                                ),
                              ),
                      ),
                      Positioned(
                        right: 0,
                        bottom: 0,
                        child: Container(
                          padding: const EdgeInsets.all(4),
                          decoration: const BoxDecoration(
                            color: Colors.white,
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(Icons.camera_alt, color: Colors.black, size: 12),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _nameController.text.isNotEmpty ? _nameController.text : 'AuraDrop User',
                        style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: Colors.white),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        _deviceNameController.text.isNotEmpty ? _deviceNameController.text : 'My Device',
                        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: Color(0xFF8A8A8A)),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _bioController.text.isNotEmpty ? _bioController.text : 'Nearby sharing made effortless',
                        style: const TextStyle(fontSize: 11, color: Colors.white54),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),

          // Display Name Field
          const Text('Display Name', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFF8A8A8A), letterSpacing: 0.5)),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: Container(
              color: Colors.white.withValues(alpha: 0.05),
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: TextField(
                controller: _nameController,
                style: const TextStyle(color: Colors.white, fontSize: 14),
                decoration: const InputDecoration(border: InputBorder.none, hintText: 'Enter name', hintStyle: TextStyle(color: Colors.white38)),
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Device Name Field
          const Text('Device Name', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFF8A8A8A), letterSpacing: 0.5)),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: Container(
              color: Colors.white.withValues(alpha: 0.05),
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: TextField(
                controller: _deviceNameController,
                style: const TextStyle(color: Colors.white, fontSize: 14),
                decoration: const InputDecoration(border: InputBorder.none, hintText: 'e.g. Pixel 8 Pro', hintStyle: TextStyle(color: Colors.white38)),
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Bio Field
          const Text('Status / Bio', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFF8A8A8A), letterSpacing: 0.5)),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: Container(
              color: Colors.white.withValues(alpha: 0.05),
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: TextField(
                controller: _bioController,
                style: const TextStyle(color: Colors.white, fontSize: 14),
                decoration: const InputDecoration(border: InputBorder.none, hintText: 'Short status message', hintStyle: TextStyle(color: Colors.white38)),
              ),
            ),
          ),
          const SizedBox(height: 24),

          // Theme Selector
          const Text('Visual Theme', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFF8A8A8A), letterSpacing: 0.5)),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: _themeOptions.map((t) {
              final isSel = _selectedTheme == t['id'];
              return ChoiceChip(
                label: Text(t['name']!),
                selected: isSel,
                selectedColor: Colors.white.withValues(alpha: 0.18),
                backgroundColor: Colors.white.withValues(alpha: 0.04),
                labelStyle: TextStyle(
                  color: isSel ? Colors.white : const Color(0xFF8A8A8A),
                  fontWeight: isSel ? FontWeight.w700 : FontWeight.w500,
                  fontSize: 12,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                  side: BorderSide(
                    color: isSel ? Colors.white.withValues(alpha: 0.35) : Colors.white.withValues(alpha: 0.08),
                    width: 0.6,
                  ),
                ),
                onSelected: (val) {
                  if (val) setState(() => _selectedTheme = t['id']!);
                },
              );
            }).toList(),
          ),
          const SizedBox(height: 24),

          // Accent Color Selector
          const Text('Accent Tone', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFF8A8A8A), letterSpacing: 0.5)),
          const SizedBox(height: 10),
          Row(
            children: _accentOptions.map((a) {
              final isSel = _selectedAccent == a['id'];
              final Color c = a['color'];
              return GestureDetector(
                onTap: () {
                  HapticFeedback.selectionClick();
                  setState(() => _selectedAccent = a['id']);
                },
                child: Container(
                  margin: const EdgeInsets.only(right: 14),
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: c,
                    border: Border.all(
                      color: isSel ? Colors.white : Colors.transparent,
                      width: 2.5,
                    ),
                    boxShadow: isSel
                        ? [
                            BoxShadow(
                              color: c.withValues(alpha: 0.3),
                              blurRadius: 8,
                              spreadRadius: 1,
                            )
                          ]
                        : null,
                  ),
                ),
              );
            }).toList(),
          ),
          const SizedBox(height: 32),

          SizedBox(
            width: double.infinity,
            child: GlassButton(
              text: 'Save Changes',
              icon: Icons.check_circle_outline,
              onPressed: _saveProfile,
            ),
          ),
        ],
      ),
    );
  }
}
