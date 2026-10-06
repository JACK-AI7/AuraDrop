import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../models/models.dart';
import '../services/native_bridge.dart';
import '../components/glass_components.dart';

class SettingsScreen extends StatefulWidget {
  final VisibilityMode currentVisibility;
  final Function(VisibilityMode) onVisibilityChanged;
  final int temporarySecondsRemaining;
  final Color accentColor;

  const SettingsScreen({
    super.key,
    required this.currentVisibility,
    required this.onVisibilityChanged,
    required this.temporarySecondsRemaining,
    required this.accentColor,
  });

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  List<Map<String, dynamic>> _trustedPeers = [];

  @override
  void initState() {
    super.initState();
    _loadTrusted();
  }

  Future<void> _loadTrusted() async {
    final list = await NativeBridgeService.getTrustedPeers();
    setState(() => _trustedPeers = list);
  }

  Future<void> _removeTrust(String peerId, String name) async {
    HapticFeedback.lightImpact();
    await NativeBridgeService.setPeerTrusted(peerId, name, false);
    _loadTrusted();
  }

  Future<void> _clearAllHistory() async {
    HapticFeedback.mediumImpact();
    final ok = await NativeBridgeService.clearTransferHistory();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(ok ? 'Transfer history cleared' : 'Error clearing history'),
          backgroundColor: ok ? const Color(0xFF10B981) : const Color(0xFFF87171),
          behavior: SnackBarBehavior.floating,
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
            'Settings & Network',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Colors.white),
          ),
          const SizedBox(height: 6),
          const Text(
            'Control discovery visibility, trusted peers, and local storage.',
            style: TextStyle(fontSize: 12, color: Colors.white54),
          ),
          const SizedBox(height: 24),

          // Visibility Section
          const Text('Nearby Visibility', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Colors.white70)),
          const SizedBox(height: 10),
          GlassCard(
            padding: const EdgeInsets.all(8),
            child: Column(
              children: [
                _buildVisibilityTile('Everyone Nearby', 'Discoverable by all devices on Wi-Fi', VisibilityMode.everyoneNearby),
                const Divider(color: Colors.white12, height: 1),
                _buildVisibilityTile(
                  'Everyone for 10 Minutes',
                  widget.currentVisibility == VisibilityMode.temporaryEveryone
                      ? 'Reverting in ${widget.temporarySecondsRemaining ~/ 60}:${(widget.temporarySecondsRemaining % 60).toString().padLeft(2, '0')}'
                      : 'Automatically reverts to Contacts Only',
                  VisibilityMode.temporaryEveryone,
                ),
                const Divider(color: Colors.white12, height: 1),
                _buildVisibilityTile('Contacts & Trusted Only', 'Only devices you have starred', VisibilityMode.contactsOnly),
                const Divider(color: Colors.white12, height: 1),
                _buildVisibilityTile('Receiving Off', 'Invisible to all nearby devices', VisibilityMode.receivingOff),
              ],
            ),
          ),
          const SizedBox(height: 24),

          // Trusted Devices Section
          const Text('Trusted Devices', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Colors.white70)),
          const SizedBox(height: 10),
          _trustedPeers.isEmpty
              ? GlassCard(
                  child: const Center(
                    child: Text('No trusted peers yet', style: TextStyle(fontSize: 13, color: Colors.white54)),
                  ),
                )
              : Column(
                  children: _trustedPeers.map((p) {
                    final name = p['peerName']?.toString() ?? 'Device';
                    final id = p['peerId']?.toString() ?? '';
                    return GlassCard(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.all(12),
                      child: Row(
                        children: [
                          const Icon(Icons.star_rounded, color: Color(0xFF818CF8), size: 20),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(name, style: const TextStyle(fontWeight: FontWeight.w600, color: Colors.white)),
                          ),
                          IconButton(
                            icon: const Icon(Icons.delete_outline, color: Colors.white38, size: 18),
                            onPressed: () => _removeTrust(id, name),
                          ),
                        ],
                      ),
                    );
                  }).toList(),
                ),
          const SizedBox(height: 24),

          // Storage Section
          const Text('Storage & Clean Up', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Colors.white70)),
          const SizedBox(height: 10),
          GlassCard(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Icon(Icons.folder_special_rounded, color: Color(0xFF38BDF8), size: 20),
                    SizedBox(width: 10),
                    Text('Downloads Location', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Colors.white)),
                  ],
                ),
                const SizedBox(height: 4),
                const Text('Internal Storage / Download / AuraDrop', style: TextStyle(fontSize: 12, color: Colors.white54)),
                const SizedBox(height: 16),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: const Color(0xFFF87171),
                    side: const BorderSide(color: Color(0xFFF87171)),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  onPressed: _clearAllHistory,
                  icon: const Icon(Icons.delete_sweep_rounded, size: 18),
                  label: const Text('Clear Transfer History'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildVisibilityTile(String title, String subtitle, VisibilityMode mode) {
    final isSelected = widget.currentVisibility == mode;
    return Material(
      color: Colors.transparent,
      child: ListTile(
        dense: true,
        onTap: () {
          HapticFeedback.selectionClick();
          widget.onVisibilityChanged(mode);
        },
        title: Text(
          title,
          style: TextStyle(
            fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
            color: isSelected ? widget.accentColor : Colors.white,
            fontSize: 14,
          ),
        ),
        subtitle: Text(subtitle, style: const TextStyle(fontSize: 11, color: Colors.white38)),
        trailing: isSelected
            ? Icon(Icons.check_circle_rounded, color: widget.accentColor, size: 18)
            : const Icon(Icons.radio_button_unchecked, color: Colors.white24, size: 18),
      ),
    );
  }
}
