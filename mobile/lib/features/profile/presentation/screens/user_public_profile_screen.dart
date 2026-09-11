import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_endpoints.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../shared/widgets/rating_stars.dart';

// ── Providers ──────────────────────────────────────────────────────────────────

final _publicProfileProvider =
    FutureProvider.autoDispose.family<Map<String, dynamic>, String>(
  (ref, userId) async {
    final dio = ref.read(dioProvider);
    final res = await dio.get(Endpoints.userPublicProfile(userId));
    return res.data as Map<String, dynamic>;
  },
);

final _userRatingsProvider =
    FutureProvider.autoDispose.family<List<dynamic>, String>(
  (ref, userId) async {
    final dio = ref.read(dioProvider);
    final res = await dio.get(Endpoints.userRatings(userId));
    return res.data as List<dynamic>;
  },
);

// ── Screen ────────────────────────────────────────────────────────────────────

class UserPublicProfileScreen extends ConsumerStatefulWidget {
  final String userId;
  const UserPublicProfileScreen({super.key, required this.userId});

  @override
  ConsumerState<UserPublicProfileScreen> createState() =>
      _UserPublicProfileScreenState();
}

class _UserPublicProfileScreenState
    extends ConsumerState<UserPublicProfileScreen> {
  bool _isBlocked = false;
  bool _blockLoading = false;

  Future<void> _toggleBlock() async {
    if (_isBlocked) {
      // Unblock
      setState(() => _blockLoading = true);
      try {
        await ref
            .read(dioProvider)
            .delete(Endpoints.userBlock(widget.userId));
        if (mounted) {
          setState(() => _isBlocked = false);
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('تم إلغاء الحظر')),
          );
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context)
              .showSnackBar(SnackBar(content: Text('$e')));
        }
      } finally {
        if (mounted) setState(() => _blockLoading = false);
      }
    } else {
      // Block — confirm first
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('حظر المستخدم'),
          content: const Text(
              'هل تريد حظر هذا المستخدم؟ لن يتمكن من التواصل معك.'),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('تراجع')),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: Colors.red),
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('حظر'),
            ),
          ],
        ),
      );
      if (confirmed != true || !mounted) return;
      setState(() => _blockLoading = true);
      try {
        await ref
            .read(dioProvider)
            .post(Endpoints.userBlock(widget.userId));
        if (mounted) {
          setState(() => _isBlocked = true);
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('تم حظر المستخدم')),
          );
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context)
              .showSnackBar(SnackBar(content: Text('$e')));
        }
      } finally {
        if (mounted) setState(() => _blockLoading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final profileAsync = ref.watch(_publicProfileProvider(widget.userId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('الملف الشخصي'),
        actions: [
          if (_blockLoading)
            const Padding(
              padding: EdgeInsets.all(14),
              child: SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2)),
            )
          else
            IconButton(
              tooltip: _isBlocked ? 'إلغاء الحظر' : 'حظر المستخدم',
              icon: Icon(
                _isBlocked ? Icons.block_flipped : Icons.block_rounded,
                color: _isBlocked ? Colors.grey : Colors.red,
              ),
              onPressed: _toggleBlock,
            ),
        ],
      ),
      body: profileAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('$e')),
        data: (p) => _ProfileBody(userId: widget.userId, profile: p),
      ),
    );
  }
}

class _ProfileBody extends ConsumerWidget {
  final String userId;
  final Map<String, dynamic> profile;
  const _ProfileBody({required this.userId, required this.profile});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final name = profile['fullName'] as String? ?? '';
    final ratingAvg =
        double.tryParse(profile['ratingAverage']?.toString() ?? '') ?? 0.0;
    final ratingCount = (profile['ratingCount'] as num?)?.toInt() ?? 0;
    final tripsAsDriver =
        (profile['completedTripsAsDriver'] as num?)?.toInt() ?? 0;
    final cancelledTripsAsDriver =
        (profile['cancelledTripsAsDriver'] as num?)?.toInt() ?? 0;
    final tripsAsPassenger =
        (profile['completedTripsAsPassenger'] as num?)?.toInt() ?? 0;
    final idVerified = profile['idVerified'] as bool? ?? false;
    final driverVerified = profile['driverVerified'] as bool? ?? false;
    final vehicleMake = profile['vehicleMake'] as String?;
    final vehicleModel = profile['vehicleModel'] as String?;
    final vehicleYear = profile['vehicleYear'] as int?;
    final vehicleColor = profile['vehicleColor'] as String?;
    final memberSince = DateTime.tryParse(
        profile['memberSince'] as String? ?? '');

    final hasVehicle = vehicleMake != null;
    final vehicleLabel = [vehicleMake, vehicleModel, vehicleYear?.toString()]
        .whereType<String>()
        .join(' ');

    final ratingsAsync = ref.watch(_userRatingsProvider(userId));

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(_publicProfileProvider(userId));
        ref.invalidate(_userRatingsProvider(userId));
      },
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          // Avatar + name
          Center(
            child: Column(
              children: [
                CircleAvatar(
                  radius: 48,
                  backgroundColor: AppColors.primary.withOpacity(0.12),
                  child: Text(
                    name.isNotEmpty ? name[0].toUpperCase() : '?',
                    style: const TextStyle(
                        fontSize: 40,
                        color: AppColors.primary,
                        fontWeight: FontWeight.bold),
                  ),
                ),
                const SizedBox(height: 12),
                Text(name.isNotEmpty ? name : 'مستخدم',
                    style: const TextStyle(
                        fontSize: 22, fontWeight: FontWeight.bold)),
                if (memberSince != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    'عضو منذ ${memberSince.year}',
                    style: TextStyle(color: Colors.grey[600], fontSize: 13),
                  ),
                ],
                const SizedBox(height: 8),
                if (ratingCount > 0)
                  RatingStars(rating: ratingAvg, count: ratingCount)
                else
                  Text('لا توجد تقييمات بعد',
                      style:
                          TextStyle(color: Colors.grey[500], fontSize: 13)),
              ],
            ),
          ),
          const SizedBox(height: 20),

          // Verification badges
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _Badge(
                icon: Icons.badge_rounded,
                label: 'هوية محققة',
                active: idVerified,
              ),
              const SizedBox(width: 12),
              _Badge(
                icon: Icons.directions_car_rounded,
                label: 'سائق محقق',
                active: driverVerified,
              ),
            ],
          ),
          const SizedBox(height: 20),

          // Stats
          Card(
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 16),
              child: Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: [
                      _Stat(
                          value: '$tripsAsDriver',
                          label: 'رحلات\nمكتملة',
                          color: AppColors.primary),
                      _divider(),
                      _Stat(
                          value: '$tripsAsPassenger',
                          label: 'رحلات\nكراكب',
                          color: AppColors.primary),
                      _divider(),
                      _Stat(
                          value: ratingCount > 0
                              ? ratingAvg.toStringAsFixed(1)
                              : '-',
                          label: 'متوسط\nالتقييم',
                          color: AppColors.primary),
                    ],
                  ),
                  if (cancelledTripsAsDriver > 0) ...[
                    const SizedBox(height: 12),
                    const Divider(height: 1),
                    const SizedBox(height: 12),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(Icons.cancel_outlined,
                            size: 16, color: Colors.red),
                        const SizedBox(width: 6),
                        Text(
                          '$cancelledTripsAsDriver رحلة ملغاة تلقائياً',
                          style: const TextStyle(
                              color: Colors.red,
                              fontSize: 13,
                              fontWeight: FontWeight.w500),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),

          // Vehicle info
          if (hasVehicle)
            Card(
              child: ListTile(
                leading: const Icon(Icons.directions_car_outlined,
                    color: AppColors.primary),
                title: Text(vehicleLabel),
                subtitle: vehicleColor != null ? Text(vehicleColor) : null,
              ),
            ),
          if (hasVehicle) const SizedBox(height: 12),

          // Ratings list
          Text('التقييمات',
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          ratingsAsync.when(
            loading: () =>
                const Center(child: CircularProgressIndicator(strokeWidth: 2)),
            error: (_, __) => Text('تعذّر تحميل التقييمات',
                style: TextStyle(color: Colors.grey[500])),
            data: (ratings) => ratings.isEmpty
                ? Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text('لا توجد تقييمات بعد',
                        style: TextStyle(color: Colors.grey[500])),
                  )
                : Column(
                    children: ratings
                        .cast<Map<String, dynamic>>()
                        .map((r) => _RatingTile(rating: r))
                        .toList(),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _divider() => Container(
        width: 1, height: 40, color: Colors.grey.shade200);
}

class _Badge extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool active;
  const _Badge(
      {required this.icon, required this.label, required this.active});

  @override
  Widget build(BuildContext context) {
    final color = active ? AppColors.primary : Colors.grey;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: color.withOpacity(0.08),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withOpacity(0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: color),
          const SizedBox(width: 4),
          Text(label,
              style: TextStyle(
                  fontSize: 12,
                  color: color,
                  fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  final String value;
  final String label;
  final Color color;
  const _Stat({required this.value, required this.label, this.color = AppColors.primary});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(value,
            style: TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.bold,
                color: color)),
        const SizedBox(height: 4),
        Text(label,
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 11, color: Colors.grey[600])),
      ],
    );
  }
}

class _RatingTile extends StatelessWidget {
  final Map<String, dynamic> rating;
  const _RatingTile({required this.rating});

  @override
  Widget build(BuildContext context) {
    final score = (rating['score'] as num?)?.toInt() ?? 0;
    final comment = rating['comment'] as String?;
    final rater = rating['rater'] as Map<String, dynamic>?;
    final raterName = rater?['fullName'] as String?;
    final createdAt =
        DateTime.tryParse(rating['createdAt'] as String? ?? '');

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  ...List.generate(
                    5,
                    (i) => Icon(
                      i < score ? Icons.star_rounded : Icons.star_outline_rounded,
                      color: Colors.amber,
                      size: 18,
                    ),
                  ),
                  const Spacer(),
                  if (raterName != null && raterName.isNotEmpty)
                    Text(raterName,
                        style: const TextStyle(
                            fontWeight: FontWeight.bold, fontSize: 12)),
                  if (createdAt != null) ...[
                    const SizedBox(width: 8),
                    Text(
                      '${createdAt.day}/${createdAt.month}/${createdAt.year}',
                      style: TextStyle(
                          color: Colors.grey[500], fontSize: 11),
                    ),
                  ],
                ],
              ),
              if (comment != null && comment.isNotEmpty) ...[
                const SizedBox(height: 6),
                Text(comment, style: const TextStyle(fontSize: 13)),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
