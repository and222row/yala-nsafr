class User {
  final String id;
  final String phoneNumber;
  final String fullName;
  final String? profilePhotoUrl;
  final String? gender;
  final String role;
  final String status;
  final bool idVerified;
  final bool driverVerified;
  final String? nationalIdPhotoUrl;
  final String? drivingLicencePhotoUrl;
  final double ratingAverage;
  final int ratingCount;
  final int completedTripsAsDriver;
  final int cancelledTripsAsDriver;
  final int completedTripsAsPassenger;
  final bool trustFlagged;
  final String? vehicleMake;
  final String? vehicleModel;
  final int? vehicleYear;
  final String? vehicleColor;
  final String? vehiclePlate;
  final String? emergencyContactName;
  final String? emergencyContactPhone;
  final String preferredLanguage;
  final String? referralCode;
  final double promoBalance;
  final DateTime createdAt;

  const User({
    required this.id,
    required this.phoneNumber,
    required this.fullName,
    this.profilePhotoUrl,
    this.gender,
    required this.role,
    required this.status,
    required this.idVerified,
    required this.driverVerified,
    this.nationalIdPhotoUrl,
    this.drivingLicencePhotoUrl,
    required this.ratingAverage,
    required this.ratingCount,
    required this.completedTripsAsDriver,
    this.cancelledTripsAsDriver = 0,
    required this.completedTripsAsPassenger,
    required this.trustFlagged,
    this.vehicleMake,
    this.vehicleModel,
    this.vehicleYear,
    this.vehicleColor,
    this.vehiclePlate,
    this.emergencyContactName,
    this.emergencyContactPhone,
    required this.preferredLanguage,
    this.referralCode,
    required this.promoBalance,
    required this.createdAt,
  });

  bool get isProfileComplete => fullName.isNotEmpty && gender != null;
  bool get canDrive => driverVerified;
  bool get idVerificationPending => !idVerified && nationalIdPhotoUrl != null;
  bool get driverVerificationPending => !driverVerified && drivingLicencePhotoUrl != null;

  factory User.fromJson(Map<String, dynamic> json) => User(
        id: json['id'] as String,
        phoneNumber: json['phoneNumber'] as String? ?? '',
        fullName: json['fullName'] as String? ?? '',
        profilePhotoUrl: json['profilePhotoUrl'] as String?,
        gender: json['gender'] as String?,
        role: json['role'] as String? ?? 'passenger',
        status: json['status'] as String? ?? 'active',
        idVerified: json['idVerified'] as bool? ?? false,
        driverVerified: json['driverVerified'] as bool? ?? false,
        nationalIdPhotoUrl: json['nationalIdPhotoUrl'] as String?,
        drivingLicencePhotoUrl: json['drivingLicencePhotoUrl'] as String?,
        ratingAverage: double.tryParse(json['ratingAverage']?.toString() ?? '') ?? 0.0,
        ratingCount: (json['ratingCount'] as num?)?.toInt() ?? 0,
        completedTripsAsDriver: (json['completedTripsAsDriver'] as num?)?.toInt() ?? 0,
        cancelledTripsAsDriver: (json['cancelledTripsAsDriver'] as num?)?.toInt() ?? 0,
        completedTripsAsPassenger: (json['completedTripsAsPassenger'] as num?)?.toInt() ?? 0,
        trustFlagged: json['trustFlagged'] as bool? ?? false,
        vehicleMake: json['vehicleMake'] as String?,
        vehicleModel: json['vehicleModel'] as String?,
        vehicleYear: json['vehicleYear'] as int?,
        vehicleColor: json['vehicleColor'] as String?,
        vehiclePlate: json['vehiclePlate'] as String?,
        emergencyContactName: json['emergencyContactName'] as String?,
        emergencyContactPhone: json['emergencyContactPhone'] as String?,
        preferredLanguage: json['preferredLanguage'] as String? ?? 'ar',
        referralCode: json['referralCode'] as String?,
        promoBalance: double.tryParse(json['promoBalance']?.toString() ?? '') ?? 0.0,
        createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ?? DateTime.now(),
      );
}
