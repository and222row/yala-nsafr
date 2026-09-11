class EarningsSummary {
  final double thisMonthOnline;
  final double thisMonthCash;
  final double allTimeOnline;
  final double allTimeCash;
  final double pendingBalance;
  final double totalWithdrawn;
  /// Already handed to Kashier and awaiting settlement — excluded from pendingBalance
  final double pendingWithdrawal;
  final double minWithdrawal;

  const EarningsSummary({
    required this.thisMonthOnline,
    required this.thisMonthCash,
    required this.allTimeOnline,
    required this.allTimeCash,
    required this.pendingBalance,
    required this.totalWithdrawn,
    this.pendingWithdrawal = 0,
    required this.minWithdrawal,
  });

  double get thisMonthTotal => thisMonthOnline + thisMonthCash;
  double get allTimeTotal => allTimeOnline + allTimeCash;

  factory EarningsSummary.fromJson(Map<String, dynamic> j) => EarningsSummary(
        thisMonthOnline: _d(j['thisMonthOnline']),
        thisMonthCash:   _d(j['thisMonthCash']),
        allTimeOnline:   _d(j['allTimeOnline']),
        allTimeCash:     _d(j['allTimeCash']),
        pendingBalance:  _d(j['pendingBalance']),
        totalWithdrawn:  _d(j['totalWithdrawn']),
        pendingWithdrawal: _d(j['pendingWithdrawal']),
        minWithdrawal:   _d(j['minWithdrawal']),
      );

  static double _d(dynamic v) =>
      double.tryParse(v?.toString() ?? '') ?? 0.0;
}

class TripEarning {
  final String bookingId;
  final String tripId;
  final String originCity;
  final String destinationCity;
  final DateTime departureTime;
  final int seatsCount;
  final double totalAmount;
  final double commissionAmount;
  final double driverPayoutAmount;
  final String paymentMethod;
  final DateTime? completedAt;

  bool get isCash => paymentMethod == 'cash';

  const TripEarning({
    required this.bookingId,
    required this.tripId,
    required this.originCity,
    required this.destinationCity,
    required this.departureTime,
    required this.seatsCount,
    required this.totalAmount,
    required this.commissionAmount,
    required this.driverPayoutAmount,
    required this.paymentMethod,
    this.completedAt,
  });

  factory TripEarning.fromJson(Map<String, dynamic> j) => TripEarning(
        bookingId:          j['bookingId'] as String,
        tripId:             j['tripId'] as String? ?? '',
        originCity:         j['originCity'] as String? ?? '',
        destinationCity:    j['destinationCity'] as String? ?? '',
        departureTime:      DateTime.tryParse(j['departureTime'] as String? ?? '') ?? DateTime.now(),
        seatsCount:         (j['seatsCount'] as num?)?.toInt() ?? 1,
        totalAmount:        double.tryParse(j['totalAmount']?.toString() ?? '') ?? 0,
        commissionAmount:   double.tryParse(j['commissionAmount']?.toString() ?? '') ?? 0,
        driverPayoutAmount: double.tryParse(j['driverPayoutAmount']?.toString() ?? '') ?? 0,
        paymentMethod:      j['paymentMethod'] as String? ?? 'cash',
        completedAt:        DateTime.tryParse(j['completedAt'] as String? ?? ''),
      );
}

class WithdrawalRequest {
  final String id;
  final double amount;
  final String payoutMethod;
  final String payoutAccount;
  final String status;
  final String? adminNote;
  final DateTime? paidAt;
  final DateTime createdAt;

  bool get isPending  => status == 'pending';
  bool get isPaid     => status == 'paid';
  bool get isRejected => status == 'rejected';

  const WithdrawalRequest({
    required this.id,
    required this.amount,
    required this.payoutMethod,
    required this.payoutAccount,
    required this.status,
    this.adminNote,
    this.paidAt,
    required this.createdAt,
  });

  factory WithdrawalRequest.fromJson(Map<String, dynamic> j) =>
      WithdrawalRequest(
        id:            j['id'] as String,
        amount:        double.tryParse(j['amount']?.toString() ?? '') ?? 0,
        payoutMethod:  j['payoutMethod'] as String? ?? '',
        payoutAccount: j['payoutAccount'] as String? ?? '',
        status:        j['status'] as String? ?? 'pending',
        adminNote:     j['adminNote'] as String?,
        paidAt:        DateTime.tryParse(j['paidAt'] as String? ?? ''),
        createdAt:     DateTime.tryParse(j['createdAt'] as String? ?? '') ?? DateTime.now(),
      );
}
