import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/models/booking.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../features/auth/providers/auth_provider.dart';
import '../../../../shared/widgets/app_button.dart';
import '../../providers/ratings_provider.dart';

class RateScreen extends ConsumerStatefulWidget {
  final Booking booking;
  const RateScreen({super.key, required this.booking});

  @override
  ConsumerState<RateScreen> createState() => _RateScreenState();
}

class _RateScreenState extends ConsumerState<RateScreen> {
  int _score = 0;
  final _commentCtrl = TextEditingController();

  @override
  void dispose() {
    _commentCtrl.dispose();
    super.dispose();
  }

  String get _rateeName {
    final myId = ref.read(authProvider).user?.id;
    final trip = widget.booking.trip;
    if (trip == null) return 'الطرف الآخر';
    // If I'm the passenger → I'm rating the driver
    if (widget.booking.passengerId == myId) return trip.driver.fullName;
    // If I'm the driver → I'm rating the passenger
    return widget.booking.passenger?.fullName ?? 'الراكب';
  }

  Future<void> _submit() async {
    if (_score == 0) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('اختر عدد النجوم أولاً')));
      return;
    }
    final ok = await ref.read(submitRatingProvider.notifier).submit(
          bookingId: widget.booking.id,
          score: _score,
          comment: _commentCtrl.text.trim().isEmpty
              ? null
              : _commentCtrl.text.trim(),
        );
    if (ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم إرسال التقييم')),
      );
      context.pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(submitRatingProvider);
    final loading = state is AsyncLoading;
    String? error;
    if (state is AsyncError) {
      error = state.error.toString().replaceFirst('Exception: ', '');
    }

    return Scaffold(
      appBar: AppBar(title: const Text('تقييم الرحلة')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: 16),

            // Who are we rating
            Center(
              child: Column(
                children: [
                  CircleAvatar(
                    radius: 36,
                    backgroundColor: AppColors.primary.withOpacity(0.1),
                    child: Text(
                      _rateeName.isNotEmpty ? _rateeName[0] : '?',
                      style: const TextStyle(
                          fontSize: 28,
                          color: AppColors.primary,
                          fontWeight: FontWeight.bold),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'كيف كانت تجربتك مع $_rateeName؟',
                    style: Theme.of(context).textTheme.titleMedium,
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 32),

            // Star selector
            Center(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: List.generate(5, (i) {
                  final starIndex = i + 1;
                  return GestureDetector(
                    onTap: () => setState(() => _score = starIndex),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 6),
                      child: Icon(
                        starIndex <= _score
                            ? Icons.star_rounded
                            : Icons.star_outline_rounded,
                        size: 44,
                        color: starIndex <= _score
                            ? AppColors.secondary
                            : Colors.grey[300],
                      ),
                    ),
                  );
                }),
              ),
            ),
            const SizedBox(height: 8),
            Center(
              child: Text(
                _scoreLabel(_score),
                style: TextStyle(
                  fontSize: 15,
                  color: _score > 0 ? AppColors.primary : Colors.grey,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            const SizedBox(height: 28),

            // Optional comment
            TextFormField(
              controller: _commentCtrl,
              decoration: const InputDecoration(
                labelText: 'تعليق (اختياري)',
                hintText: 'شارك تجربتك...',
                alignLabelWithHint: true,
              ),
              maxLines: 3,
              maxLength: 500,
              textInputAction: TextInputAction.done,
            ),

            if (error != null) ...[
              const SizedBox(height: 8),
              Text(error,
                  style: const TextStyle(color: Colors.red, fontSize: 13)),
            ],

            const Spacer(),
            AppButton(
              label: 'إرسال التقييم',
              loading: loading,
              onPressed: _score > 0 ? _submit : null,
            ),
            const SizedBox(height: 12),
            AppButton(
              label: 'تخطي',
              outlined: true,
              onPressed: loading ? null : () => context.pop(),
            ),
          ],
        ),
      ),
    );
  }

  String _scoreLabel(int score) => switch (score) {
        1 => 'سيئ جداً',
        2 => 'سيئ',
        3 => 'مقبول',
        4 => 'جيد',
        5 => 'ممتاز',
        _ => 'اختر تقييمك',
      };
}
