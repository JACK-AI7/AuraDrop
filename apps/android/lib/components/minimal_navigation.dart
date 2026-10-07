import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../theme/aura_theme.dart';

class MinimalNavigationBar extends StatelessWidget {
  final int currentIndex;
  final ValueChanged<int> onTabSelected;
  final int activeTransfersCount;
  final int unreadChatCount;

  const MinimalNavigationBar({
    super.key,
    required this.currentIndex,
    required this.onTabSelected,
    this.activeTransfersCount = 0,
    this.unreadChatCount = 0,
  });

  @override
  Widget build(BuildContext context) {
    final theme = AuraTheme.of(context);
    final bottomInset = MediaQuery.of(context).padding.bottom;

    return SafeArea(
      top: false,
      left: false,
      right: false,
      minimum: EdgeInsets.only(
        left: 16,
        right: 16,
        bottom: bottomInset > 0 ? bottomInset + 4 : 12,
      ),
      child: Container(
        height: 64,
        decoration: BoxDecoration(
          color: theme.isDark ? const Color(0xFF0D0D0D) : const Color(0xFFFFFFFF),
          borderRadius: BorderRadius.circular(26),
          border: Border.all(
            color: theme.border,
            width: 1.0,
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: theme.isDark ? 0.45 : 0.08),
              blurRadius: 18,
              offset: const Offset(0, 6),
            ),
          ],
        ),
        padding: const EdgeInsets.symmetric(horizontal: 10),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceAround,
          children: [
            _buildNavItem(0, Icons.public_rounded, 'Home', theme),
            _buildNavItem(
              1,
              Icons.swap_vert_rounded,
              'Transfers',
              theme,
              badgeCount: activeTransfersCount,
            ),
            _buildNavItem(
              2,
              Icons.chat_bubble_outline_rounded,
              'Chat',
              theme,
              badgeCount: unreadChatCount,
            ),
            _buildNavItem(3, Icons.history_rounded, 'History', theme),
            _buildNavItem(4, Icons.person_outline_rounded, 'Profile', theme),
          ],
        ),
      ),
    );
  }

  Widget _buildNavItem(
    int index,
    IconData icon,
    String label,
    AuraTheme theme, {
    int badgeCount = 0,
  }) {
    final isSelected = currentIndex == index;
    final itemColor = isSelected ? theme.textPrimary : theme.textSecondary;

    return GestureDetector(
      onTap: () {
        if (!isSelected) {
          HapticFeedback.selectionClick();
          onTabSelected(index);
        }
      },
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
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
                  color: itemColor,
                ),
                if (badgeCount > 0)
                  Positioned(
                    right: -7,
                    top: -3,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                      decoration: BoxDecoration(
                        color: theme.actionBackground,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      constraints: const BoxConstraints(minWidth: 14, minHeight: 14),
                      child: Text(
                        '$badgeCount',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: theme.actionText,
                          fontSize: 9,
                          fontWeight: FontWeight.w800,
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
                fontSize: 10,
                fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                color: itemColor,
                letterSpacing: 0.1,
              ),
            ),
            const SizedBox(height: 2),
            AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              width: isSelected ? 12 : 0,
              height: 2,
              decoration: BoxDecoration(
                color: isSelected ? theme.textPrimary : Colors.transparent,
                borderRadius: BorderRadius.circular(1),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
