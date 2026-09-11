import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

class RatingStars extends StatelessWidget {
  final double rating;
  final int count;
  final double size;

  const RatingStars({
    super.key,
    required this.rating,
    this.count = 0,
    this.size = 16,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.star_rounded, size: size, color: AppColors.secondary),
        const SizedBox(width: 2),
        Text(
          rating.toStringAsFixed(1),
          style: TextStyle(fontSize: size - 2, fontWeight: FontWeight.w600),
        ),
        if (count > 0) ...[
          const SizedBox(width: 2),
          Text(
            '($count)',
            style: TextStyle(
              fontSize: size - 4,
              color: Colors.grey,
            ),
          ),
        ],
      ],
    );
  }
}
