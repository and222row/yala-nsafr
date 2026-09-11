import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_endpoints.dart';
import '../../../../features/auth/providers/auth_provider.dart';
import '../../../../shared/widgets/rating_stars.dart';

class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(authProvider.notifier).refreshUser();
    });
  }

  Future<void> _refresh() => ref.read(authProvider.notifier).refreshUser();

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authProvider).user;
    if (user == null) return const SizedBox.shrink();

    return Scaffold(
      appBar: AppBar(
        title: const Text('حسابي'),
        actions: [
          IconButton(
            icon: const Icon(Icons.edit_rounded),
            onPressed: () => context.push('/profile/edit'),
          ),
          IconButton(
            icon: const Icon(Icons.logout_rounded),
            onPressed: () async {
              final ok = await showDialog<bool>(
                context: context,
                builder: (dialogContext) => AlertDialog(
                  title: const Text('تسجيل الخروج'),
                  content: const Text('هل أنت متأكد؟'),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(dialogContext, false),
                        child: const Text('إلغاء')),
                    FilledButton(
                        onPressed: () => Navigator.pop(dialogContext, true),
                        child: const Text('خروج')),
                  ],
                ),
              );
              if (ok == true) {
                ref.read(authProvider.notifier).signOut();
              }
            },
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          // Avatar + name
          Center(
            child: Column(
              children: [
                CircleAvatar(
                  radius: 44,
                  backgroundColor: AppColors.primary.withOpacity(0.1),
                  backgroundImage: user.profilePhotoUrl != null
                      ? CachedNetworkImageProvider(user.profilePhotoUrl!)
                      : null,
                  child: user.profilePhotoUrl == null
                      ? Text(
                          user.fullName.isNotEmpty ? user.fullName[0] : '?',
                          style: const TextStyle(
                              fontSize: 36,
                              color: AppColors.primary,
                              fontWeight: FontWeight.bold),
                        )
                      : null,
                ),
                const SizedBox(height: 12),
                Text(user.fullName,
                    style: const TextStyle(
                        fontSize: 22, fontWeight: FontWeight.bold)),
                const SizedBox(height: 4),
                Text(user.phoneNumber,
                    style: TextStyle(color: Colors.grey[600])),
                if (user.ratingCount > 0) ...[
                  const SizedBox(height: 8),
                  RatingStars(
                      rating: user.ratingAverage, count: user.ratingCount),
                ],
              ],
            ),
          ),
          const SizedBox(height: 24),

          // Verification status
          _SectionCard(
            title: 'التحقق',
            children: [
              _VerifTile(
                label: 'هوية وطنية',
                verified: user.idVerified,
                pending: user.idVerificationPending,
                onTap: user.idVerified || user.idVerificationPending
                    ? null
                    : () => context.push('/profile/id-verification'),
              ),
              _VerifTile(
                label: 'تحقق السائق',
                verified: user.driverVerified,
                pending: user.driverVerificationPending,
                onTap: user.driverVerified || user.driverVerificationPending
                    ? null
                    : () => context.push('/profile/driver-verification'),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Stats
          if (user.completedTripsAsPassenger > 0 || user.completedTripsAsDriver > 0)
            _SectionCard(
              title: 'إحصائياتي',
              children: [
                ListTile(
                  leading: const Icon(Icons.book_online_rounded),
                  title: const Text('رحلات حجزتها'),
                  trailing: Text('${user.completedTripsAsPassenger}',
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                ),
                ListTile(
                  leading: const Icon(Icons.directions_car_rounded),
                  title: const Text('رحلات قدّمتها'),
                  trailing: Text('${user.completedTripsAsDriver}',
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                ),
              ],
            ),
          const SizedBox(height: 12),

          // Earnings (drivers only)
          if (user.canDrive || user.completedTripsAsDriver > 0) ...[
            const SizedBox(height: 12),
            Card(
              child: ListTile(
                leading: const Icon(Icons.account_balance_wallet_rounded,
                    color: AppColors.primary),
                title: const Text('أرباحي'),
                subtitle: const Text('سجل الرحلات المكتملة'),
                trailing: const Icon(Icons.chevron_right_rounded),
                onTap: () => context.push('/drivers/earnings'),
              ),
            ),
          ],
          const SizedBox(height: 12),

          // Subscription
          _SubscriptionTile(),
          const SizedBox(height: 12),

          // Referral
          if (user.referralCode != null) ...[
            const SizedBox(height: 12),
            _ReferralCard(
              code: user.referralCode!,
              promoBalance: user.promoBalance,
            ),
          ],
          const SizedBox(height: 12),

          // Disputes
          ListTile(
            leading: const Icon(Icons.gavel_rounded),
            title: const Text('نزاعاتي'),
            trailing: const Icon(Icons.chevron_right_rounded),
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            tileColor: Theme.of(context).colorScheme.surfaceContainerHighest,
            onTap: () => context.push('/disputes'),
          ),

          // Admin panel (visible to admins only)
          if (user.role == 'admin') ...[
            const SizedBox(height: 24),
            Padding(
              padding: const EdgeInsets.only(bottom: 8, right: 4),
              child: Text('لوحة الإدارة',
                  style: Theme.of(context)
                      .textTheme
                      .titleSmall
                      ?.copyWith(color: Colors.red[700])),
            ),
            Card(
              color: Colors.red.shade50,
              child: Column(
                children: [
                  ListTile(
                    leading: Icon(Icons.report_problem_rounded,
                        color: Colors.red[700]),
                    title: const Text('إدارة النزاعات'),
                    trailing: const Icon(Icons.chevron_right_rounded),
                    onTap: () => context.push('/admin/disputes'),
                  ),
                ],
              ),
            ),
          ],
        ],
        ),
      ),
    );
  }
}

class _ReferralCard extends StatelessWidget {
  final String code;
  final double promoBalance;
  const _ReferralCard({required this.code, required this.promoBalance});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      color: AppColors.primary.withOpacity(0.06),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: AppColors.primary.withOpacity(0.2)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.card_giftcard_rounded, color: AppColors.primary),
                const SizedBox(width: 8),
                Text(
                  'دعوة الأصدقاء',
                  style: theme.textTheme.titleMedium?.copyWith(
                      color: AppColors.primary, fontWeight: FontWeight.w700),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              'شارك كودك واحصل على 30 جنيه لكل صديق يكمل أول رحلة',
              style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 12),
            InkWell(
              onTap: () async {
                await Clipboard.setData(ClipboardData(text: code));
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('تم نسخ الكود!'),
                      duration: Duration(seconds: 2),
                    ),
                  );
                }
              },
              borderRadius: BorderRadius.circular(8),
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                decoration: BoxDecoration(
                  color: AppColors.primary.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                      color: AppColors.primary.withOpacity(0.3), width: 1.5),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      code,
                      style: theme.textTheme.titleLarge?.copyWith(
                        color: AppColors.primary,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 4,
                      ),
                    ),
                    const SizedBox(width: 10),
                    const Icon(Icons.copy_rounded,
                        size: 18, color: AppColors.primary),
                  ],
                ),
              ),
            ),
            if (promoBalance > 0) ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  const Icon(Icons.account_balance_wallet_rounded,
                      size: 16, color: Colors.green),
                  const SizedBox(width: 6),
                  Text(
                    'رصيدك الترحيبي: ${promoBalance.toStringAsFixed(0)} جنيه',
                    style: theme.textTheme.bodySmall?.copyWith(
                        color: Colors.green, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  final String title;
  final List<Widget> children;
  const _SectionCard({required this.title, required this.children});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 8, right: 4),
          child: Text(title,
              style: Theme.of(context)
                  .textTheme
                  .titleSmall
                  ?.copyWith(color: Colors.grey[600])),
        ),
        Card(child: Column(children: children)),
      ],
    );
  }
}

// ── Subscription tile ─────────────────────────────────────────────────────────

class _SubscriptionTile extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final statusAsync = ref.watch(_subStatusProvider);

    return statusAsync.when(
      loading: () => const SizedBox.shrink(),
      error: (_, __) => const SizedBox.shrink(),
      data: (data) {
        final canPost = data['canPost'] as bool? ?? true;
        final isFreeTrial = data['isFreeTrial'] as bool? ?? false;
        final trialDaysLeft = data['trialDaysLeft'] as int? ?? 0;
        final sub = data['subscription'] as Map<String, dynamic>?;
        final isActive = sub != null && sub['status'] == 'active';

        Color bgColor;
        Color borderColor;
        IconData icon;
        String title;
        String subtitle;

        if (isFreeTrial) {
          bgColor = Colors.green.shade50;
          borderColor = Colors.green.shade300;
          icon = Icons.verified_rounded;
          title = 'الاشتراك المجاني';
          subtitle = 'متبقي $trialDaysLeft يوم من الفترة المجانية';
        } else if (isActive) {
          bgColor = AppColors.primary.withOpacity(0.06);
          borderColor = AppColors.primary.withOpacity(0.3);
          icon = Icons.workspace_premium_rounded;
          title = 'مشترك Pro';
          subtitle = 'اشتراك شهري نشط — 200 ج/شهر';
        } else {
          bgColor = Colors.orange.shade50;
          borderColor = Colors.orange.shade300;
          icon = Icons.star_border_rounded;
          title = 'اشترك في يلا Pro';
          subtitle = 'انتهت الفترة المجانية — 200 ج/شهر لنشر الرحلات';
        }

        return GestureDetector(
          onTap: () => context.push('/subscription'),
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: bgColor,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: borderColor),
            ),
            child: Row(
              children: [
                Icon(icon,
                    color: isFreeTrial
                        ? Colors.green.shade700
                        : isActive
                            ? AppColors.primary
                            : Colors.orange.shade700,
                    size: 28),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title,
                          style: const TextStyle(
                              fontWeight: FontWeight.bold, fontSize: 15)),
                      const SizedBox(height: 2),
                      Text(subtitle,
                          style: TextStyle(
                              fontSize: 12, color: Colors.grey[700])),
                    ],
                  ),
                ),
                if (!isActive)
                  const Icon(Icons.chevron_right_rounded, color: Colors.grey),
              ],
            ),
          ),
        );
      },
    );
  }
}

final _subStatusProvider =
    FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  final res = await ref.read(dioProvider).get(Endpoints.subscriptionStatus);
  return res.data as Map<String, dynamic>;
});

class _VerifTile extends StatelessWidget {
  final String label;
  final bool verified;
  final bool pending;
  final VoidCallback? onTap;

  const _VerifTile({
    required this.label,
    required this.verified,
    this.pending = false,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final Icon icon;
    final String subtitle;
    final Color subtitleColor;

    if (verified) {
      icon = const Icon(Icons.verified_rounded, color: AppColors.primary);
      subtitle = 'تم التحقق';
      subtitleColor = AppColors.primary;
    } else if (pending) {
      icon = const Icon(Icons.hourglass_top_rounded, color: Colors.orange);
      subtitle = 'قيد المراجعة';
      subtitleColor = Colors.orange;
    } else {
      icon = const Icon(Icons.radio_button_unchecked_rounded, color: Colors.grey);
      subtitle = 'غير محقق';
      subtitleColor = Colors.grey;
    }

    return ListTile(
      leading: icon,
      title: Text(label),
      subtitle: Text(subtitle, style: TextStyle(color: subtitleColor)),
      trailing: onTap != null
          ? const Icon(Icons.chevron_right_rounded)
          : null,
      onTap: onTap,
    );
  }
}
