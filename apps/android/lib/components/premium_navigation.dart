import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class PremiumNavigationBar extends StatelessWidget {
  final int currentIndex;
  final ValueChanged<int> onTabSelected;
  final int activeTransfersCount;
  final int unreadChatCount;

  const PremiumNavigationBar({
    super.key,
    required this.currentIndex,
    required this.onTabSelected,
    this.activeTransfersCount = 0,
    this.unreadChatCount = 0,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(28),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 24, sigmaY: 24),
          child: Container(
            height: 66,
            padding: const EdgeInsets.symmetric(horizontal: 8),
            decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: 0.65),
              borderRadius: BorderRadius.circular(28),
              border: Border.all(
                color: Colors.white.withValues(alpha: 0.12),
                width: 0.7,
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.45),
                  blurRadius: 24,
                  offset: const Offset(0, 8),
                ),
              ],
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildNavItem(0, Icons.near_me_rounded, 'HOME'),
                _buildNavItem(
                  1,
                  Icons.swap_vert_rounded,
                  'TRANSFERS',
                  badgeCount: activeTransfersCount,
                ),
                _buildNavItem(
                  2,
                  Icons.chat_bubble_outline_rounded,
                  'CHAT',
                  badgeCount: unreadChatCount,
                ),
                _buildNavItem(3, Icons.history_rounded, 'HISTORY'),
                _buildNavItem(4, Icons.person_outline_rounded, 'PROFILE'),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildNavItem(int index, IconData icon, String label, {int badgeCount = 0}) {
    final isSelected = currentIndex == index;

    return GestureDetector(
      onTap: () {
        if (!isSelected) {
          HapticFeedback.selectionClick();
          onTabSelected(index);
        }
      },
      behavior: HitTestBehavior.opaque,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOutCubic,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: isSelected ? Colors.white.withValues(alpha: 0.12) : Colors.transparent,
          borderRadius: BorderRadius.circular(20),
          border: isSelected
              ? Border.all(color: Colors.white.withValues(alpha: 0.18), width: 0.6)
              : null,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                Icon(
                  icon,
                  size: 20,
                  color: isSelected ? Colors.white : const Color(0xFF7E7E7E),
                ),
                if (badgeCount > 0)
                  Positioned(
                    right: -6,
                    top: -4,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      constraints: const BoxConstraints(minWidth: 14, minHeight: 14),
                      child: Text(
                        '$badgeCount',
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: Colors.black,
                          fontSize: 9,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 3),
            Text(
              label,
              style: TextStyle(
                fontSize: 9,
                fontWeight: isSelected ? FontWeight.w800 : FontWeight.w500,
                letterSpacing: 0.8,
                color: isSelected ? Colors.white : const Color(0xFF7E7E7E),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
