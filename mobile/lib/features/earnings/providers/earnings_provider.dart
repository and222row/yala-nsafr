import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/api/api_client.dart';
import '../../../core/api/api_endpoints.dart';
import '../../../core/models/earnings.dart';

final earningsSummaryProvider =
    FutureProvider.autoDispose<EarningsSummary>((ref) async {
  final dio = ref.read(dioProvider);
  final res = await dio.get(Endpoints.earningsSummary);
  return EarningsSummary.fromJson(res.data as Map<String, dynamic>);
});

final earningsTripsProvider =
    FutureProvider.autoDispose<List<TripEarning>>((ref) async {
  final dio = ref.read(dioProvider);
  final res = await dio.get(Endpoints.earningsTrips);
  return (res.data as List<dynamic>)
      .map((e) => TripEarning.fromJson(e as Map<String, dynamic>))
      .toList();
});

final driverWithdrawalsProvider =
    FutureProvider.autoDispose<List<WithdrawalRequest>>((ref) async {
  final dio = ref.read(dioProvider);
  final res = await dio.get(Endpoints.driverWithdrawals);
  return (res.data as List<dynamic>)
      .map((e) => WithdrawalRequest.fromJson(e as Map<String, dynamic>))
      .toList();
});

Future<void> requestWithdrawal(
  WidgetRef ref, {
  required double amount,
  required String payoutMethod,
  required String payoutAccount,
  required String payoutName,
  String? payoutBank,
}) async {
  final dio = ref.read(dioProvider);
  await dio.post(Endpoints.driverWithdrawals, data: {
    'amount': amount,
    'payoutMethod': payoutMethod,
    'payoutAccount': payoutAccount,
    'payoutName': payoutName,
    if (payoutBank != null) 'payoutBank': payoutBank,
  });
  ref.invalidate(earningsSummaryProvider);
  ref.invalidate(driverWithdrawalsProvider);
}
