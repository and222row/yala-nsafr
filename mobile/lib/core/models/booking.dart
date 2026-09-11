import 'trip.dart';
import 'user.dart';

class Booking {
  final String id;
  final String tripId;
  final Trip? trip;
  final String passengerId;
  final User? passenger;
  final int seatsCount;
  final double totalAmount;
  final double commissionAmount;
  final double driverPayoutAmount;
  final double commissionRate;
  final String paymentMethod;
  final String status;
  final DateTime? confirmedAt;
  final DateTime? completedAt;
  final bool driverConfirmedCompletion;
  final bool passengerConfirmedCompletion;
  final DateTime? cancelledAt;
  final String? cancellationReason;
  final String? disputeId;
  final String? paymentUrl;
  final DateTime createdAt;
  final bool hasRated;

  const Booking({
    required this.id,
    required this.tripId,
    this.trip,
    required this.passengerId,
    this.passenger,
    required this.seatsCount,
    required this.totalAmount,
    required this.commissionAmount,
    required this.driverPayoutAmount,
    required this.commissionRate,
    required this.paymentMethod,
    required this.status,
    this.confirmedAt,
    this.completedAt,
    required this.driverConfirmedCompletion,
    required this.passengerConfirmedCompletion,
    this.cancelledAt,
    this.cancellationReason,
    this.disputeId,
    this.paymentUrl,
    required this.createdAt,
    this.hasRated = false,
  });

  bool get isActive => status == 'confirmed' || status == 'in_progress';
  bool get isInProgress => status == 'in_progress';
  bool get isCompleted => status == 'trip_completed';
  bool get isCancelled =>
      status == 'cancelled_by_passenger' || status == 'cancelled_by_driver' || status == 'refunded';
  bool get isDisputed => status == 'disputed';
  bool get canCancel =>
      (status == 'confirmed' || status == 'pending_payment') &&
      disputeId == null &&
      !isCancelled;
  bool get canRate => isCompleted && disputeId == null && !hasRated;
  bool get canDispute => (isActive || isCompleted) && disputeId == null;

  factory Booking.fromJson(Map<String, dynamic> json) => Booking(
        id: json['id'] as String,
        tripId: json['tripId'] as String? ?? '',
        trip: json['trip'] != null
            ? Trip.fromJson(json['trip'] as Map<String, dynamic>)
            : null,
        passengerId: json['passengerId'] as String? ?? '',
        passenger: json['passenger'] != null
            ? User.fromJson(json['passenger'] as Map<String, dynamic>)
            : null,
        seatsCount: (json['seatsCount'] as num?)?.toInt() ?? 1,
        totalAmount: double.tryParse(json['totalAmount']?.toString() ?? '') ?? 0.0,
        commissionAmount: double.tryParse(json['commissionAmount']?.toString() ?? '') ?? 0.0,
        driverPayoutAmount: double.tryParse(json['driverPayoutAmount']?.toString() ?? '') ?? 0.0,
        commissionRate: double.tryParse(json['commissionRate']?.toString() ?? '') ?? 0.07,
        paymentMethod: json['paymentMethod'] as String? ?? 'cash',
        status: json['status'] as String? ?? 'pending_payment',
        confirmedAt: DateTime.tryParse(json['confirmedAt'] as String? ?? ''),
        completedAt: DateTime.tryParse(json['completedAt'] as String? ?? ''),
        driverConfirmedCompletion: json['driverConfirmedCompletion'] as bool? ?? false,
        passengerConfirmedCompletion: json['passengerConfirmedCompletion'] as bool? ?? false,
        cancelledAt: DateTime.tryParse(json['cancelledAt'] as String? ?? ''),
        cancellationReason: json['cancellationReason'] as String?,
        disputeId: json['disputeId'] as String?,
        paymentUrl: json['paymentUrl'] as String?,
        createdAt:
            DateTime.tryParse(json['createdAt'] as String? ?? '') ?? DateTime.now(),
        hasRated: json['hasRated'] as bool? ?? false,
      );
}
