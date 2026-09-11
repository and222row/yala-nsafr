class ChatMessage {
  final String id;
  final String tripId;
  final String senderId;
  final String senderName;
  final String body;
  final DateTime createdAt;

  const ChatMessage({
    required this.id,
    required this.tripId,
    required this.senderId,
    required this.senderName,
    required this.body,
    required this.createdAt,
  });

  factory ChatMessage.fromJson(Map<String, dynamic> json) {
    final sender = json['sender'] as Map<String, dynamic>?;
    final rawName = sender?['fullName'] as String? ?? '';
    return ChatMessage(
      id: json['id'] as String,
      tripId: json['tripId'] as String? ?? '',
      senderId: json['senderId'] as String? ?? '',
      senderName: rawName.isNotEmpty ? rawName : (sender?['phoneNumber'] as String? ?? '؟'),
      body: json['body'] as String? ?? '',
      createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ?? DateTime.now(),
    );
  }
}
