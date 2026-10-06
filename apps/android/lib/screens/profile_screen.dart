import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../models/models.dart';
import '../services/native_bridge.dart';
import '../components/glass_components.dart';
import '../components/micro_interactions.dart';

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
  late TextEditingController _bioController;
  late String _selectedTheme;
  late String _selectedAccent;
  late int _selectedAvatarIndex;

  final List<Map<String, String>> _themeOptions = [
    {'id': 'glass_dark', 'name': 'Glass Dark'},
    {'id': 'obsidian_glass', 'name': 'Obsidian Glass'},
    {'id': 'aurora_glass', 'name': 'Aurora Glass'},
    {'id': 'crystal_glass', 'name': 'Crystal Glass'},
    {'id': 'glass_light', 'name': 'Glass Light'},
  ];

  final List<Map<String, dynamic>> _accentOptions = [
    {'id': 'cyan', 'name': 'Cyan', 'color': Color(0xFF38BDF8)},
    {'id': 'indigo', 'name': 'Indigo', 'color': Color(0xFF818CF8)},
    {'id': 'emerald', 'name': 'Emerald', 'color': Color(0xFF10B981)},
    {'id': 'rose', 'name': 'Rose', 'color': Color(0xFFF43F5E)},
    {'id': 'amber', 'name': 'Amber', 'color': Color(0xFFF59E0B)},
  ];

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.profile.displayName);
    _bioController = TextEditingController(text: widget.profile.bio);
    _selectedTheme = widget.profile.theme;
    _selectedAccent = widget.profile.accent;
    _selectedAvatarIndex = widget.profile.avatarIndex;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _bioController.dispose();
    super.dispose();
  }

  Future<void> _saveProfile() async {
    HapticFeedback.mediumImpact();
    final name = _nameController.text.trim();
    final bio = _bioController.text.trim();

    await NativeBridgeService.saveUserProfile('display_name', name.isNotEmpty ? name : 'AuraDrop User');
    await NativeBridgeService.saveUserProfile('bio', bio);
    await NativeBridgeService.saveUserProfile('theme', _selectedTheme);
    await NativeBridgeService.saveUserProfile('accent', _selectedAccent);
    await NativeBridgeService.saveUserProfile('avatar_index', _selectedAvatarIndex.toString());

    widget.onProfileUpdated('display_name', name.isNotEmpty ? name : 'AuraDrop User');
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
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'User Profile & Identity',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Colors.white),
          ),
          const SizedBox(height: 6),
          const Text(
            'Your identity is shared securely with nearby peers during discovery.',
            style: TextStyle(fontSize: 12, color: Colors.white54),
          ),
          const SizedBox(height: 20),

          // Interactive 3D Depth Profile Card (React Bits inspired)
          DepthCard(
            child: Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(24),
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    Colors.white.withValues(alpha: 0.15),
                    Colors.white.withValues(alpha: 0.04),
                  ],
                ),
                border: Border.all(
                  color: Colors.white.withValues(alpha: 0.2),
                  width: 1.2,
                ),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.35),
                    blurRadius: 25,
                    offset: const Offset(0, 10),
                  ),
                ],
              ),
              child: Row(
                children: [
                  Container(
                    width: 68,
                    height: 68,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: LinearGradient(
                        colors: [
                          _accentOptions.firstWhere((a) => a['id'] == _selectedAccent, orElse: () => _accentOptions[0])['color'] as Color,
                          Colors.purpleAccent,
                        ],
                      ),
                      border: Border.all(color: Colors.white, width: 2),
                      boxShadow: [
                        BoxShadow(
                          color: (_accentOptions.firstWhere((a) => a['id'] == _selectedAccent, orElse: () => _accentOptions[0])['color'] as Color).withValues(alpha: 0.4),
                          blurRadius: 15,
                        ),
                      ],
                    ),
                    child: Center(
                      child: Text(
                        _nameController.text.isNotEmpty ? _nameController.text.substring(0, 1).toUpperCase() : 'A',
                        style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: Colors.white),
                      ),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _nameController.text.isNotEmpty ? _nameController.text : 'AuraDrop User',
                          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Colors.white),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          _bioController.text.isNotEmpty ? _bioController.text : 'Nearby sharing made effortless',
                          style: const TextStyle(fontSize: 12, color: Colors.white60),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            'TOUCH PARALLAX ACTIVE',
                            style: TextStyle(
                              fontSize: 9,
                              fontWeight: FontWeight.w800,
                              letterSpacing: 0.8,
                              color: (_accentOptions.firstWhere((a) => a['id'] == _selectedAccent, orElse: () => _accentOptions[0])['color'] as Color),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),

          // Name Field
          const Text('Display Name', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Colors.white70)),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: Container(
              color: Colors.white.withValues(alpha: 0.08),
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: TextField(
                controller: _nameController,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(border: InputBorder.none, hintText: 'Enter name'),
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Bio Field
          const Text('Status / Bio', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Colors.white70)),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: Container(
              color: Colors.white.withValues(alpha: 0.08),
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: TextField(
                controller: _bioController,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(border: InputBorder.none, hintText: 'Short status message'),
              ),
            ),
          ),
          const SizedBox(height: 24),

          // Theme Selector
          const Text('Glass Theme', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Colors.white70)),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: _themeOptions.map((t) {
              final isSel = _selectedTheme == t['id'];
              return ChoiceChip(
                label: Text(t['name']!),
                selected: isSel,
                selectedColor: Colors.white.withValues(alpha: 0.25),
                backgroundColor: Colors.white.withValues(alpha: 0.06),
                labelStyle: TextStyle(
                  color: isSel ? Colors.white : Colors.white60,
                  fontWeight: isSel ? FontWeight.w700 : FontWeight.w500,
                ),
                onSelected: (val) {
                  if (val) setState(() => _selectedTheme = t['id']!);
                },
              );
            }).toList(),
          ),
          const SizedBox(height: 24),

          // Accent Color Selector
          const Text('Accent Hue', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Colors.white70)),
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
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: c,
                    border: isSel ? Border.all(color: Colors.white, width: 3) : null,
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
