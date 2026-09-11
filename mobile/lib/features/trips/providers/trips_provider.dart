import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../../../core/api/api_client.dart';
import '../../../core/api/api_endpoints.dart';
import '../../../core/models/trip.dart';
import '../../../core/models/trip_comment.dart';

// ── Search ────────────────────────────────────────────────────────────────────

final tripSearchProvider =
    StateNotifierProvider.autoDispose<TripSearchNotifier, AsyncValue<List<Trip>>>(
  (ref) => TripSearchNotifier(ref.read(dioProvider)),
);

class TripSearchNotifier extends StateNotifier<AsyncValue<List<Trip>>> {
  final Dio _dio;
  TripSearchNotifier(this._dio) : super(const AsyncData([]));

  Future<void> search(TripSearchParams params) async {
    state = const AsyncLoading();
    try {
      final res = await _dio.get(
        Endpoints.searchTrips,
        queryParameters: {
          'originCity': params.from,
          'destinationCity': params.to,
          'departureDate': params.date.toIso8601String().split('T').first,
          'seats': params.seats,
          'limit': 50,
          if (params.womenOnly) 'womenOnly': true,
        },
      );
      final list = ((res.data as Map<String, dynamic>)['data'] as List<dynamic>)
          .map((e) => Trip.fromJson(e as Map<String, dynamic>))
          .toList();
      state = AsyncData(list);
    } on DioException catch (e) {
      state = AsyncError(ApiException.fromDioError(e), StackTrace.current);
    }
  }
}

// ── Single trip ───────────────────────────────────────────────────────────────

final tripDetailProvider =
    FutureProvider.autoDispose.family<Trip, String>((ref, id) async {
  final dio = ref.read(dioProvider);
  final res = await dio.get(Endpoints.tripById(id));
  return Trip.fromJson(res.data as Map<String, dynamic>);
});

// ── Refresh token — increment to force MyTripsScreen to reload ────────────────
final tripsRefreshTokenProvider = StateProvider<int>((ref) => 0);

// ── My trips (driver) — kept for ref.invalidate() from detail screens ─────────
// Screens that display the list use MyTripsNotifier (stateful widget) instead.

final myTripsProvider = FutureProvider.autoDispose<List<Trip>>((ref) async {
  final dio = ref.read(dioProvider);
  final res = await dio.get(Endpoints.myTrips, queryParameters: {'page': 1, 'limit': 20});
  final body = res.data;
  final list = body is Map ? (body['data'] as List? ?? []) : body as List;
  return list.map((e) => Trip.fromJson(e as Map<String, dynamic>)).toList();
});

// ── Co-passengers ─────────────────────────────────────────────────────────────

final coPassengersProvider =
    FutureProvider.autoDispose.family<List<Map<String, dynamic>>, String>(
        (ref, tripId) async {
  final dio = ref.read(dioProvider);
  final res = await dio.get(Endpoints.tripCoPassengers(tripId));
  return (res.data as List<dynamic>)
      .map((e) => e as Map<String, dynamic>)
      .toList();
});

// ── Bookings for a trip (driver) ──────────────────────────────────────────────

final tripBookingsProvider =
    FutureProvider.autoDispose.family<List<dynamic>, String>((ref, tripId) async {
  final dio = ref.read(dioProvider);
  final res = await dio.get(Endpoints.tripBookings(tripId));
  return res.data as List<dynamic>;
});

// ── Trip comments ─────────────────────────────────────────────────────────────

final tripCommentsProvider =
    FutureProvider.autoDispose.family<List<TripComment>, String>((ref, tripId) async {
  final dio = ref.read(dioProvider);
  final res = await dio.get(Endpoints.tripComments(tripId));
  return (res.data as List<dynamic>)
      .map((e) => TripComment.fromJson(e as Map<String, dynamic>))
      .toList();
});

// ── Post trip ─────────────────────────────────────────────────────────────────

class PostTripNotifier extends StateNotifier<AsyncValue<void>> {
  final Dio _dio;
  PostTripNotifier(this._dio) : super(const AsyncData(null));

  Future<Trip?> post(Map<String, dynamic> body) async {
    state = const AsyncLoading();
    try {
      final res = await _dio.post(Endpoints.trips, data: body);
      state = const AsyncData(null);
      return Trip.fromJson(res.data as Map<String, dynamic>);
    } on DioException catch (e) {
      state = AsyncError(ApiException.fromDioError(e), StackTrace.current);
      return null;
    }
  }
}

final postTripProvider =
    StateNotifierProvider.autoDispose<PostTripNotifier, AsyncValue<void>>(
  (ref) => PostTripNotifier(ref.read(dioProvider)),
);

// ── Update trip (driver) ──────────────────────────────────────────────────────

class UpdateTripNotifier extends StateNotifier<AsyncValue<void>> {
  final Dio _dio;
  UpdateTripNotifier(this._dio) : super(const AsyncData(null));

  Future<Trip?> update(String tripId, Map<String, dynamic> body) async {
    state = const AsyncLoading();
    try {
      final res = await _dio.patch(Endpoints.updateTrip(tripId), data: body);
      state = const AsyncData(null);
      return Trip.fromJson(res.data as Map<String, dynamic>);
    } on DioException catch (e) {
      state = AsyncError(ApiException.fromDioError(e), StackTrace.current);
      return null;
    }
  }
}

final updateTripProvider =
    StateNotifierProvider.autoDispose<UpdateTripNotifier, AsyncValue<void>>(
  (ref) => UpdateTripNotifier(ref.read(dioProvider)),
);

// ── Cancel trip (driver) ──────────────────────────────────────────────────────

Future<void> cancelTrip(WidgetRef ref, String tripId, {String? reason}) async {
  final dio = ref.read(dioProvider);
  await dio.patch(Endpoints.cancelTrip(tripId),
      data: reason != null ? {'reason': reason} : null);
}

// ── SOS ───────────────────────────────────────────────────────────────────────

Future<void> reportSos(WidgetRef ref, String tripId) async {
  final dio = ref.read(dioProvider);
  await dio.post(Endpoints.tripSos(tripId));
}
