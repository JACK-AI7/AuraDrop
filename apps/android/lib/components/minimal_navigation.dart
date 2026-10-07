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
        height: 68,
        decoration: BoxDecoration(
          color: theme.isDark ? const Color(0xFF1C1C1E) : const Color(0xFFFFFFFF),
          borderRadius: BorderRadius.circular(28),
          border: Border.all(
            color: theme.isDark ? const Color(0xFF3A3A3C) : const Color(0xFFE5E5EA),
            width: 1.5,
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: theme.isDark ? 0.70 : 0.12),
              blurRadius: 24,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        padding: const EdgeInsets.symmetric(horizontal: 8),
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
    final itemIconColor = isSelected
        ? const Color(0xFF0A84FF)
        : (theme.isDark ? const Color(0xFFE5E5EA) : const Color(0xFF48484A));
    final itemTextColor = isSelected
        ? (theme.isDark ? Colors.white : Colors.black)
        : (theme.isDark ? const Color(0xFFD1D1D6) : const Color(0xFF636366));

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
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: isSelected
              ? (theme.isDark ? const Color(0xFF2C2C2E) : const Color(0xFFF2F2F7))
              : Colors.transparent,
          borderRadius: BorderRadius.circular(18),
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
                  size: isSelected ? 23 : 21,
                  color: itemIconColor,
                ),
                if (badgeCount > 0)
                  Positioned(
                    right: -7,
                    top: -3,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                      decoration: BoxDecoration(
                        color: const Color(0xFF0A84FF),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      constraints: const BoxConstraints(minWidth: 14, minHeight: 14),
                      child: Text(
                        '$badgeCount',
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: Colors.white,
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
                fontSize: 11,
                fontWeight: isSelected ? FontWeight.w800 : FontWeight.w600,
                color: itemTextColor,
                letterSpacing: 0.1,
              ),
            ),
            const SizedBox(height: 2),
            AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              width: isSelected ? 16 : 0,
              height: 2.5,
              decoration: BoxDecoration(
                color: isSelected ? const Color(0xFF0A84FF) : Colors.transparent,
                borderRadius: BorderRadius.circular(1.5),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
