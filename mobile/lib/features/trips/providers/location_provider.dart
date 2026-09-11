import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import '../../../core/api/api_client.dart';
import '../../../core/api/api_endpoints.dart';

class TripLocationPoint {
  final double latitude;
  final double longitude;
  final DateTime recordedAt;

  const TripLocationPoint({
    required this.latitude,
    required this.longitude,
    required this.recordedAt,
  });

  factory TripLocationPoint.fromJson(Map<String, dynamic> json) =>
      TripLocationPoint(
        latitude: double.tryParse(json['latitude']?.toString() ?? '') ?? 0,
        longitude: double.tryParse(json['longitude']?.toString() ?? '') ?? 0,
        recordedAt:
            DateTime.tryParse(json['recordedAt'] as String? ?? '') ?? DateTime.now(),
      );
}

/// Passenger: fetch the latest GPS point for a trip.
final tripLocationProvider =
    FutureProvider.autoDispose.family<TripLocationPoint?, String>((ref, tripId) async {
  final dio = ref.read(dioProvider);
  try {
    final res = await dio.get(Endpoints.tripLocationLatest(tripId));
    if (res.data == null) return null;
    return TripLocationPoint.fromJson(res.data as Map<String, dynamic>);
  } catch (_) {
    return null;
  }
});

/// Driver: periodically posts current GPS position to the backend.
class DriverLocationNotifier extends StateNotifier<bool> {
  final Dio _dio;
  final String _tripId;
  Timer? _timer;

  DriverLocationNotifier(this._dio, this._tripId) : super(false);

  Future<void> start() async {
    if (state) return;
    final granted = await _requestPermission();
    if (!granted) return;
    state = true;
    await _postNow();
    _timer = Timer.periodic(const Duration(minutes: 1), (_) => _postNow());
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
    if (mounted) state = false;
  }

  Future<bool> _requestPermission() async {
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) {
      perm = await Geolocator.requestPermission();
    }
    return perm != LocationPermission.denied &&
        perm != LocationPermission.deniedForever;
  }

  Future<void> _postNow() async {
    try {
      final pos = await Geolocator.getCurrentPosition(
        locationSettings:
            const LocationSettings(accuracy: LocationAccuracy.medium),
      );
      await _dio.post(
        Endpoints.tripLocation(_tripId),
        data: {'latitude': pos.latitude, 'longitude': pos.longitude},
      );
    } catch (_) {}
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}

final driverLocationProvider = StateNotifierProvider.autoDispose
    .family<DriverLocationNotifier, bool, String>(
  (ref, tripId) => DriverLocationNotifier(ref.read(dioProvider), tripId),
);
