import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/api_client.dart';
import '../api/api_endpoints.dart';
import 'fcm_service.dart';

// Call once after the user is authenticated to push the device token to backend.
Future<void> uploadFcmToken(Ref ref) async {
  try {
    final token = await FcmService.getToken();
    if (token == null) return;

    final dio = ref.read(dioProvider);
    await dio.patch(Endpoints.fcmToken, data: {'fcmToken': token});
  } catch (_) {
    // Non-fatal: the backend still works, notifications will just be skipped for this device.
  }

  // Re-upload whenever FCM refreshes the token.
  FcmService.onTokenRefresh.listen((newToken) async {
    try {
      final dio = ref.read(dioProvider);
      await dio.patch(Endpoints.fcmToken, data: {'fcmToken': newToken});
    } catch (_) {}
  });
}
