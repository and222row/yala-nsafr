import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/models/app_notification.dart';
import '../../providers/notifications_provider.dart';
import '../../../../shared/widgets/skeletons.dart';

class NotificationsInboxScreen extends ConsumerStatefulWidget {
  const NotificationsInboxScreen({super.key});

  @override
  ConsumerState<NotificationsInboxScreen> createState() =>
      _NotificationsInboxScreenState();
}

class _NotificationsInboxScreenState
    extends ConsumerState<NotificationsInboxScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      markAllNotificationsRead(ref);
    });
  }

  void _navigateTo(AppNotification notif) {
    final data = notif.data;
    if (data == null) return;

    final screen = data['screen'] as String?;
    final tripId = data['tripId'] as String?;
    final disputeId = data['disputeId'] as String?;

    if (screen == 'trip_chat' && tripId != null) {
      context.push('/trips/$tripId/chat', extra: <String, dynamic>{'label': ''});
      return;
    }

    final route = switch (screen) {
      'trip_detail' when tripId != null => '/trips/$tripId',
      'trip_passengers' when tripId != null => '/trips/$tripId/passengers',
      'my_bookings' => '/my-bookings',
      'dispute_detail' when disputeId != null => '/disputes/$disputeId',
      'admin_disputes' => '/admin/disputes',
      'earnings' => '/drivers/earnings',
      _ => null,
    };

    if (route != null) context.push(route);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final notifAsync = ref.watch(notificationsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('الإشعارات')),
      body: notifAsync.when(
        loading: () => SkeletonCardList(
          itemBuilder: () => const NotifTileSkeleton(),
          count: 6,
          padding: EdgeInsets.zero,
        ),
        error: (_, __) => const Center(child: Text('تعذّر تحميل الإشعارات')),
        data: (notifications) {
          if (notifications.isEmpty) {
            return Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.notifications_off_rounded,
                      size: 64, color: theme.colorScheme.outline),
                  const SizedBox(height: 12),
                  Text('لا توجد إشعارات',
                      style: theme.textTheme.bodyLarge?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant)),
                ],
              ),
            );
          }

          return RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(notificationsProvider);
              await ref.read(notificationsProvider.future);
            },
            child: ListView.separated(
              itemCount: notifications.length,
              separatorBuilder: (_, __) =>
                  Divider(height: 1, color: theme.colorScheme.outlineVariant),
              itemBuilder: (_, i) => _NotifTile(
                notif: notifications[i],
                onTap: () => _navigateTo(notifications[i]),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _NotifTile extends StatelessWidget {
  final AppNotification notif;
  final VoidCallback onTap;

  const _NotifTile({required this.notif, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isUnread = !notif.read;
    final (icon, color) = _iconAndColor(notif.data, theme);

    return InkWell(
      onTap: onTap,
      child: ColoredBox(
        color: isUnread
            ? theme.colorScheme.primaryContainer.withOpacity(0.15)
            : Colors.transparent,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: color.withOpacity(0.12),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, size: 20, color: color),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Text(
                            notif.title,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              fontWeight: isUnread
                                  ? FontWeight.w700
                                  : FontWeight.w500,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          _relativeTime(notif.createdAt),
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.outline,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(
                      notif.body,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              if (isUnread)
                Padding(
                  padding: const EdgeInsets.only(top: 4, right: 4),
                  child: Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(
                      color: theme.colorScheme.primary,
                      shape: BoxShape.circle,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  (IconData, Color) _iconAndColor(Map<String, dynamic>? data, ThemeData theme) {
    if (data?['type'] == 'sos') return (Icons.warning_rounded, Colors.red);
    return switch (data?['screen'] as String?) {
      'trip_detail' || 'trip_chat' => (Icons.directions_car_rounded, Colors.green),
      'my_bookings' || 'booking_detail' =>
        (Icons.book_online_rounded, Colors.blue),
      'dispute_detail' || 'admin_disputes' =>
        (Icons.gavel_rounded, Colors.orange),
      'earnings' => (Icons.account_balance_wallet_rounded, Colors.teal),
      _ => (Icons.notifications_rounded, theme.colorScheme.primary),
    };
  }

  String _relativeTime(DateTime dt) {
    final diff = DateTime.now().difference(dt);
    if (diff.inMinutes < 1) return 'الآن';
    if (diff.inMinutes < 60) return 'منذ ${diff.inMinutes} د';
    if (diff.inHours < 24) return 'منذ ${diff.inHours} س';
    if (diff.inDays < 7) return 'منذ ${diff.inDays} أيام';
    return '${dt.day}/${dt.month}/${dt.year}';
  }
}
