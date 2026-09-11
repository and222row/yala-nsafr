import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/api/api_client.dart';
import '../../../core/api/api_endpoints.dart';
import '../../../core/models/chat_message.dart';

final tripMessagesProvider =
    FutureProvider.autoDispose.family<List<ChatMessage>, String>((ref, tripId) async {
  final dio = ref.read(dioProvider);
  final res = await dio.get(Endpoints.tripMessages(tripId));
  return (res.data as List<dynamic>)
      .map((e) => ChatMessage.fromJson(e as Map<String, dynamic>))
      .toList();
});

Future<ChatMessage> sendChatMessage(
    WidgetRef ref, String tripId, String body) async {
  final dio = ref.read(dioProvider);
  final res = await dio.post(
    Endpoints.tripMessages(tripId),
    data: {'body': body},
  );
  return ChatMessage.fromJson(res.data as Map<String, dynamic>);
}
