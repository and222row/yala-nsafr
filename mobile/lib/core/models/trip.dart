class TripDriver {
  final String id;
  final String fullName;
  final String? profilePhotoUrl;
  final double ratingAverage;
  final int ratingCount;
  final int completedTripsAsDriver;
  final bool idVerified;
  final bool driverVerified;
  final String? vehicleMake;
  final String? vehicleModel;
  final int? vehicleYear;
  final String? vehicleColor;

  const TripDriver({
    required this.id,
    required this.fullName,
    this.profilePhotoUrl,
    required this.ratingAverage,
    required this.ratingCount,
    required this.completedTripsAsDriver,
    required this.idVerified,
    required this.driverVerified,
    this.vehicleMake,
    this.vehicleModel,
    this.vehicleYear,
    this.vehicleColor,
  });

  String get vehicleLabel {
    if (vehicleMake == null) return '';
    final parts = [vehicleMake, vehicleModel, vehicleYear?.toString()].whereType<String>();
    return parts.join(' ');
  }

  factory TripDriver.fromJson(Map<String, dynamic> json) => TripDriver(
        id: json['id'] as String,
        fullName: json['fullName'] as String? ?? '',
        profilePhotoUrl: json['profilePhotoUrl'] as String?,
        ratingAverage: double.tryParse(json['ratingAverage']?.toString() ?? '') ?? 0.0,
        ratingCount: (json['ratingCount'] as num?)?.toInt() ?? 0,
        completedTripsAsDriver: (json['completedTripsAsDriver'] as num?)?.toInt() ?? 0,
        idVerified: json['idVerified'] as bool? ?? false,
        driverVerified: json['driverVerified'] as bool? ?? false,
        vehicleMake: json['vehicleMake'] as String?,
        vehicleModel: json['vehicleModel'] as String?,
        vehicleYear: json['vehicleYear'] as int?,
        vehicleColor: json['vehicleColor'] as String?,
      );
}

class Trip {
  final String id;
  final String driverId;
  final TripDriver driver;
  final String originCity;
  final String? originAddress;
  final String destinationCity;
  final String? destinationAddress;
  final DateTime departureTime;
  final DateTime? estimatedArrivalTime;
  final int totalSeats;
  final int availableSeats;
  final double pricePerSeat;
  final String status;
  final bool womenOnly;
  final bool smokingAllowed;
  final bool petsAllowed;
  final bool airConditioning;
  final String luggageSize;
  final String chatPreference;
  final String? notes;
  final Map<String, dynamic>? preferences;
  final DateTime createdAt;

  const Trip({
    required this.id,
    required this.driverId,
    required this.driver,
    required this.originCity,
    this.originAddress,
    required this.destinationCity,
    this.destinationAddress,
    required this.departureTime,
    this.estimatedArrivalTime,
    required this.totalSeats,
    required this.availableSeats,
    required this.pricePerSeat,
    required this.status,
    required this.womenOnly,
    required this.smokingAllowed,
    required this.petsAllowed,
    this.airConditioning = false,
    required this.luggageSize,
    required this.chatPreference,
    this.notes,
    this.preferences,
    required this.createdAt,
  });

  bool get isAvailable => status == 'scheduled' && availableSeats > 0;

  factory Trip.fromJson(Map<String, dynamic> json) {
    final driverJson = json['driver'] as Map<String, dynamic>?;
    final driver = driverJson != null
        ? TripDriver.fromJson(driverJson)
        : TripDriver(
            id: json['driverId'] as String? ?? '',
            fullName: '',
            ratingAverage: 0,
            ratingCount: 0,
            completedTripsAsDriver: 0,
            idVerified: false,
            driverVerified: false,
          );

    final prefs = json['preferences'] as Map<String, dynamic>?;
    final smokingAllowed = (json['smokingAllowed'] as bool?) ??
        (prefs?['smoking'] as bool?) ?? false;
    final petsAllowed = (json['petsAllowed'] as bool?) ??
        (prefs?['pets'] as bool?) ?? false;

    return Trip(
      id: json['id'] as String,
      driverId: json['driverId'] as String? ?? '',
      driver: driver,
      originCity: json['originCity'] as String? ?? '',
      originAddress: json['originAddress'] as String?,
      destinationCity: json['destinationCity'] as String? ?? '',
      destinationAddress: json['destinationAddress'] as String?,
      departureTime:
          DateTime.tryParse(json['departureTime'] as String? ?? '') ?? DateTime.now(),
      estimatedArrivalTime:
          DateTime.tryParse(json['estimatedArrivalTime'] as String? ?? ''),
      totalSeats: json['totalSeats'] as int? ?? 1,
      availableSeats: json['availableSeats'] as int? ?? 0,
      pricePerSeat: double.tryParse(json['pricePerSeat']?.toString() ?? '') ?? 0.0,
      status: json['status'] as String? ?? 'scheduled',
      womenOnly: json['womenOnly'] as bool? ?? false,
      smokingAllowed: smokingAllowed,
      petsAllowed: petsAllowed,
      airConditioning: json['airConditioning'] as bool? ?? false,
      luggageSize: json['luggageSize'] as String? ?? 'medium',
      chatPreference: json['chatPreference'] as String? ?? 'friendly',
      notes: json['notes'] as String?,
      preferences: json['preferences'] as Map<String, dynamic>?,
      createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ?? DateTime.now(),
    );
  }
}

class TripSearchParams {
  final String from;
  final String to;
  final DateTime date;
  final int seats;
  final bool womenOnly;

  const TripSearchParams({
    required this.from,
    required this.to,
    required this.date,
    this.seats = 1,
    this.womenOnly = false,
  });
}
