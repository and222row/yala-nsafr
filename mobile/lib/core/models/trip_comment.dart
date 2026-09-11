class TripComment {
  final String id;
  final String tripId;
  final String userId;
  final String userFullName;
  final String userPhone;
  final String? userPhotoUrl;
  final String body;
  final DateTime createdAt;

  const TripComment({
    required this.id,
    required this.tripId,
    required this.userId,
    required this.userFullName,
    required this.userPhone,
    this.userPhotoUrl,
    required this.body,
    required this.createdAt,
  });

  String get displayName =>
      userFullName.isNotEmpty ? userFullName : (userPhone.isNotEmpty ? userPhone : 'مستخدم');

  factory TripComment.fromJson(Map<String, dynamic> json) {
    final user = json['user'] as Map<String, dynamic>? ?? {};
    return TripComment(
      id: json['id'] as String,
      tripId: json['tripId'] as String,
      userId: json['userId'] as String,
      userFullName: user['fullName'] as String? ?? '',
      userPhone: user['phoneNumber'] as String? ?? '',
      userPhotoUrl: user['profilePhotoUrl'] as String?,
      body: json['body'] as String,
      createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ?? DateTime.now(),
    );
  }
}
