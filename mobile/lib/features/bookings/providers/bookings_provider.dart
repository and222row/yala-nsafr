import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../../../core/api/api_client.dart';
import '../../../core/api/api_endpoints.dart';
import '../../../core/models/booking.dart';

// ── My bookings — kept for ref.invalidate() from other screens ────────────────
// Screens that display the list use MyBookingsNotifier (stateful widget) instead.

final myBookingsProvider = FutureProvider.autoDispose<List<Booking>>((ref) async {
  final dio = ref.read(dioProvider);
  final res = await dio.get(Endpoints.myBookings, queryParameters: {'page': 1, 'limit': 20});
  final body = res.data;
  final list = body is Map ? (body['data'] as List? ?? []) : body as List;
  return list.map((e) => Booking.fromJson(e as Map<String, dynamic>)).toList();
});

// ── Cancellation policy ───────────────────────────────────────────────────────
// Shown before payment. Read from the server so it always matches what cancellation
// actually enforces — the thresholds are admin-configurable.

class CancellationPolicy {
  final double freeCancelHours;
  final double lateCancelHours;
  final double lateCancelFeePct;
  // Dispute deadlines ride along on the same endpoint so the dispute screens can state
  // the real numbers the backend enforces instead of a hardcoded 48.
  final double disputeWindowHours;
  final double disputeSlaHours;

  const CancellationPolicy({
    required this.freeCancelHours,
    required this.lateCancelHours,
    required this.lateCancelFeePct,
    required this.disputeWindowHours,
    required this.disputeSlaHours,
  });

  int get feePercent => (lateCancelFeePct * 100).round();

  factory CancellationPolicy.fromJson(Map<String, dynamic> j) => CancellationPolicy(
        freeCancelHours: double.tryParse(j['freeCancelHours']?.toString() ?? '') ?? 48,
        lateCancelHours: double.tryParse(j['lateCancelHours']?.toString() ?? '') ?? 2,
        lateCancelFeePct: double.tryParse(j['lateCancelFeePct']?.toString() ?? '') ?? 0.15,
        disputeWindowHours:
            double.tryParse(j['disputeWindowHours']?.toString() ?? '') ?? 48,
        disputeSlaHours: double.tryParse(j['disputeSlaHours']?.toString() ?? '') ?? 48,
      );
}

final cancellationPolicyProvider =
    FutureProvider.autoDispose<CancellationPolicy>((ref) async {
  final dio = ref.read(dioProvider);
  final res = await dio.get(Endpoints.cancellationPolicy);
  return CancellationPolicy.fromJson(res.data as Map<String, dynamic>);
});

// ── Single booking ────────────────────────────────────────────────────────────

final bookingDetailProvider =
    FutureProvider.autoDispose.family<Booking, String>((ref, id) async {
  final dio = ref.read(dioProvider);
  final res = await dio.get(Endpoints.bookingById(id));
  return Booking.fromJson(res.data as Map<String, dynamic>);
});

// ── Create booking ────────────────────────────────────────────────────────────

class CreateBookingNotifier extends StateNotifier<AsyncValue<void>> {
  final Dio _dio;
  CreateBookingNotifier(this._dio) : super(const AsyncData(null));

  Future<Booking?> create(Map<String, dynamic> body) async {
    state = const AsyncLoading();
    try {
      final res = await _dio.post(Endpoints.bookings, data: body);
      state = const AsyncData(null);
      return Booking.fromJson(res.data as Map<String, dynamic>);
    } on DioException catch (e) {
      state = AsyncError(ApiException.fromDioError(e), StackTrace.current);
      return null;
    }
  }
}

final createBookingProvider =
    StateNotifierProvider.autoDispose<CreateBookingNotifier, AsyncValue<void>>(
  (ref) => CreateBookingNotifier(ref.read(dioProvider)),
);

// ── Confirm completion ────────────────────────────────────────────────────────

Future<void> confirmCompletion(WidgetRef ref, String bookingId) async {
  final dio = ref.read(dioProvider);
  await dio.patch(Endpoints.confirmCompletion(bookingId));
}

// ── Cancel booking ────────────────────────────────────────────────────────────

/// Returns { canCancel, policy, hoursUntilDeparture, totalAmount, refundAmount, cancellationFee, isCash }
Future<Map<String, dynamic>> fetchCancelPreview(
    WidgetRef ref, String bookingId) async {
  final dio = ref.read(dioProvider);
  final res = await dio.get(Endpoints.cancelPreview(bookingId));
  return res.data as Map<String, dynamic>;
}

Future<Map<String, dynamic>> cancelBooking(WidgetRef ref, String bookingId,
    {String? reason}) async {
  final dio = ref.read(dioProvider);
  final res = await dio.patch(Endpoints.cancelBooking(bookingId),
      data: reason != null ? {'reason': reason} : null);
  return res.data as Map<String, dynamic>;
}
