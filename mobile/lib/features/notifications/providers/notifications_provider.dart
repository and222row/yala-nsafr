import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/api/api_client.dart';
import '../../../core/api/api_endpoints.dart';
import '../../../core/models/app_notification.dart';

final notificationsProvider =
    FutureProvider.autoDispose<List<AppNotification>>((ref) async {
  final dio = ref.read(dioProvider);
  final res = await dio.get(Endpoints.notifications);
  return (res.data as List<dynamic>)
      .map((e) => AppNotification.fromJson(e as Map<String, dynamic>))
      .toList();
});

final unreadCountProvider = FutureProvider.autoDispose<int>((ref) async {
  final dio = ref.read(dioProvider);
  final res = await dio.get(Endpoints.notificationsUnreadCount);
  return ((res.data as Map<String, dynamic>)['count'] as num).toInt();
});

Future<void> markAllNotificationsRead(WidgetRef ref) async {
  final dio = ref.read(dioProvider);
  await dio.patch(Endpoints.notificationsReadAll);
  ref.invalidate(notificationsProvider);
  ref.invalidate(unreadCountProvider);
}
