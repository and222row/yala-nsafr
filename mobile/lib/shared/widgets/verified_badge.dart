import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

class VerifiedBadge extends StatelessWidget {
  final Widget child;
  const VerifiedBadge({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        child,
        Positioned(
          top: -4,
          right: -4,
          child: Container(
            width: 12,
            height: 12,
            decoration: const BoxDecoration(
              color: AppColors.secondary,
              shape: BoxShape.circle,
            ),
          ),
        ),
      ],
    );
  }
}
