import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_endpoints.dart';
import '../../../../core/models/user.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../auth/providers/auth_provider.dart';

Future<void> guardedPostTrip(BuildContext context, WidgetRef ref) async {
  final user = ref.read(authProvider).user;
  if (user == null) return;

  if (!user.driverVerified) {
    if (!context.mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      useRootNavigator: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => _VerificationSheet(user: user),
    );
    return;
  }

  // Check subscription
  if (!context.mounted) return;
  // Show brief loading while we check
  bool? canPost;
  await showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (ctx) {
      _checkSubscription(ref).then((result) {
        canPost = result;
        if (ctx.mounted) Navigator.of(ctx).pop();
      }).catchError((_) {
        canPost = true; // on error, allow through
        if (ctx.mounted) Navigator.of(ctx).pop();
      });
      return const AlertDialog(
        content: Padding(
          padding: EdgeInsets.all(20),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircularProgressIndicator(),
              SizedBox(width: 16),
              Text('جاري التحقق...'),
            ],
          ),
        ),
      );
    },
  );

  if (!context.mounted) return;

  if (canPost == false) {
    context.push('/subscription');
  } else {
    context.push('/trips/post');
  }
}

Future<bool> _checkSubscription(WidgetRef ref) async {
  final res = await ref.read(dioProvider).get(Endpoints.subscriptionStatus);
  final data = res.data as Map<String, dynamic>;
  return data['canPost'] as bool? ?? true;
}

class _VerificationSheet extends StatelessWidget {
  final User user;
  const _VerificationSheet({super.key, required this.user});

  @override
  Widget build(BuildContext context) {
    final isPending = user.driverVerificationPending;

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 12, 24, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: Colors.grey.shade300,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 20),
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                color: AppColors.primary.withOpacity(0.1),
                shape: BoxShape.circle,
              ),
              child: Icon(
                isPending
                    ? Icons.hourglass_top_rounded
                    : Icons.verified_user_rounded,
                size: 32,
                color: AppColors.primary,
              ),
            ),
            const SizedBox(height: 16),
            Text(
              isPending
                  ? 'طلب التحقق قيد المراجعة'
                  : 'التحقق من هوية السائق مطلوب',
              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              isPending
                  ? 'سيتم مراجعة بياناتك خلال 24–48 ساعة. ستصلك إشعار عند الموافقة.'
                  : 'لضمان سلامة الركاب، يجب إكمال التحقق من رخصة القيادة وبيانات السيارة قبل نشر الرحلات.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 13, color: Colors.grey[600], height: 1.5),
            ),
            const SizedBox(height: 24),
            if (!isPending) ...[
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  icon: const Icon(Icons.arrow_forward_rounded),
                  label: const Text('إبدأ التحقق الآن'),
                  onPressed: () {
                    Navigator.pop(context);
                    context.push('/profile/driver-verification');
                  },
                ),
              ),
              const SizedBox(height: 8),
            ],
            SizedBox(
              width: double.infinity,
              child: TextButton(
                onPressed: () => Navigator.pop(context),
                child: Text(isPending ? 'حسناً' : 'لاحقاً'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
