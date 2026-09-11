import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../../../core/api/api_client.dart';
import '../../../core/api/api_endpoints.dart';
import '../../../core/models/dispute.dart';

final myDisputesProvider = FutureProvider.autoDispose<List<Dispute>>((ref) async {
  final dio = ref.read(dioProvider);
  final res = await dio.get(Endpoints.myDisputes);
  return (res.data as List<dynamic>)
      .map((e) => Dispute.fromJson(e as Map<String, dynamic>))
      .toList();
});

final disputeDetailProvider =
    FutureProvider.autoDispose.family<Dispute, String>((ref, id) async {
  final dio = ref.read(dioProvider);
  final res = await dio.get(Endpoints.disputeById(id));
  return Dispute.fromJson(res.data as Map<String, dynamic>);
});

class OpenDisputeNotifier extends StateNotifier<AsyncValue<void>> {
  final Dio _dio;
  OpenDisputeNotifier(this._dio) : super(const AsyncData(null));

  Future<Dispute?> open(Map<String, dynamic> body) async {
    state = const AsyncLoading();
    try {
      final res = await _dio.post(Endpoints.openDispute(''), data: body);
      state = const AsyncData(null);
      return Dispute.fromJson(res.data as Map<String, dynamic>);
    } on DioException catch (e) {
      state = AsyncError(ApiException.fromDioError(e), StackTrace.current);
      return null;
    }
  }
}

final openDisputeProvider =
    StateNotifierProvider.autoDispose<OpenDisputeNotifier, AsyncValue<void>>(
  (ref) => OpenDisputeNotifier(ref.read(dioProvider)),
);

class RespondDisputeNotifier extends StateNotifier<AsyncValue<void>> {
  final Dio _dio;
  RespondDisputeNotifier(this._dio) : super(const AsyncData(null));

  Future<bool> respond(String disputeId, String response) async {
    state = const AsyncLoading();
    try {
      await _dio.post(
        Endpoints.disputeRespond(disputeId),
        data: {'response': response},
      );
      state = const AsyncData(null);
      return true;
    } on DioException catch (e) {
      state = AsyncError(ApiException.fromDioError(e), StackTrace.current);
      return false;
    }
  }
}

final respondDisputeProvider =
    StateNotifierProvider.autoDispose<RespondDisputeNotifier, AsyncValue<void>>(
  (ref) => RespondDisputeNotifier(ref.read(dioProvider)),
);
