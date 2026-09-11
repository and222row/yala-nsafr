import 'package:firebase_analytics/firebase_analytics.dart';

class AnalyticsService {
  AnalyticsService._();

  static final _analytics = FirebaseAnalytics.instance;

  static Future<void> logSearch({
    required String origin,
    required String destination,
    required DateTime date,
    required int seats,
  }) =>
      _analytics.logEvent(
        name: 'search_trips',
        parameters: {
          'origin': origin,
          'destination': destination,
          'date':
              '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}',
          'seats': seats,
        },
      );

  static Future<void> logViewTrip({
    required String tripId,
    required String origin,
    required String destination,
    required double price,
  }) =>
      _analytics.logViewItem(
        currency: 'EGP',
        value: price,
        items: [
          AnalyticsEventItem(
            itemId: tripId,
            itemName: '$origin → $destination',
            price: price,
          ),
        ],
      );

  static Future<void> logBookingStart({
    required String tripId,
    required int seats,
    required double pricePerSeat,
  }) =>
      _analytics.logBeginCheckout(
        currency: 'EGP',
        value: pricePerSeat * seats,
        items: [
          AnalyticsEventItem(
            itemId: tripId,
            quantity: seats,
            price: pricePerSeat,
          ),
        ],
      );

  static Future<void> logBookingConfirmed({
    required String tripId,
    required int seats,
    required double amount,
  }) =>
      _analytics.logPurchase(
        currency: 'EGP',
        value: amount,
        items: [
          AnalyticsEventItem(
            itemId: tripId,
            quantity: seats,
            price: seats > 0 ? amount / seats : amount,
          ),
        ],
      );

  static Future<void> logTripShared({required String tripId}) =>
      _analytics.logShare(
        contentType: 'trip',
        itemId: tripId,
        method: 'share_plus',
      );

  static Future<void> logLogin() =>
      _analytics.logLogin(loginMethod: 'phone_otp');
}
