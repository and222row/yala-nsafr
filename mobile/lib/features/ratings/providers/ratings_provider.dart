import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../../../core/api/api_client.dart';
import '../../../core/api/api_endpoints.dart';

class SubmitRatingNotifier extends StateNotifier<AsyncValue<void>> {
  final Dio _dio;
  SubmitRatingNotifier(this._dio) : super(const AsyncData(null));

  Future<bool> submit({
    required String bookingId,
    required int score,
    String? comment,
  }) async {
    state = const AsyncLoading();
    try {
      await _dio.post(Endpoints.ratings, data: {
        'bookingId': bookingId,
        'score': score,
        if (comment != null && comment.isNotEmpty) 'comment': comment,
      });
      state = const AsyncData(null);
      return true;
    } on DioException catch (e) {
      state = AsyncError(ApiException.fromDioError(e), StackTrace.current);
      return false;
    }
  }
}

final submitRatingProvider =
    StateNotifierProvider.autoDispose<SubmitRatingNotifier, AsyncValue<void>>(
  (ref) => SubmitRatingNotifier(ref.read(dioProvider)),
);
