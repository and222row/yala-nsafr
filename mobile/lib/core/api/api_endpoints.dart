class Endpoints {
  static const otpSend = '/auth/otp/send';
  static const otpVerify = '/auth/otp/verify';
  static const authRefresh = '/auth/refresh';
  static const authLogout = '/auth/logout';
  static const me = '/users/me';
  static const idVerification = '/users/me/id-verification';
  static const driverVerification = '/users/me/driver-verification';
  static const fcmToken = '/users/me/fcm-token';

  static const trips = '/trips';
  static const searchTrips = '/trips/search';
  static const myTrips = '/trips/driver/my-trips';
  static String userPublicProfile(String id) => '/users/$id/profile';
  static String tripById(String id) => '/trips/$id';
  static String tripBookings(String id) => '/trips/$id/bookings';
  static String tripComments(String id) => '/trips/$id/comments';

  static const bookings = '/bookings';
  static const myBookings = '/bookings/my';
  static String bookingById(String id) => '/bookings/$id';
  static String bookingPaymentUrl(String id) => '/bookings/$id/payment-url';
  static String bookingMockConfirm(String id) => '/bookings/$id/mock-confirm';
  static String bookingHeal(String id) => '/bookings/$id/heal';
  static String bookingApprove(String id) => '/bookings/$id/approve';
  static String bookingReject(String id) => '/bookings/$id/reject';
  static String userBlock(String id) => '/users/$id/block';
  static const String subscriptionStatus = '/subscriptions/status';
  static const String subscriptionCheckout = '/subscriptions/checkout';
  static String confirmCompletion(String id) => '/bookings/$id/confirm-completion';
  static String cancelBooking(String id) => '/bookings/$id/cancel';
  static String cancelPreview(String id) => '/bookings/$id/cancel-preview';
  static String cancelTrip(String id) => '/trips/$id/cancel';
  static String updateTrip(String id) => '/trips/$id';

  static const ratings = '/ratings';
  static String userRatings(String userId) => '/ratings/user/$userId';

  static const disputes = '/disputes';
  static String disputeById(String id) => '/disputes/$id';
  static String disputeStatus(String id) => '/disputes/$id/status';
  static String disputeEvidence(String id) => '/disputes/$id/evidence';
  static String disputeRespond(String id) => '/disputes/$id/respond';
  static const myDisputes = '/disputes/my';

  // ── Admin ──────────────────────────────────────────────────────────────────
  static const adminDisputes = '/admin/disputes';
  static String adminDisputeById(String id) => '/admin/disputes/$id';
  static String adminDisputeAssign(String id) => '/admin/disputes/$id/assign';
  static String adminDisputeResolve(String id) => '/admin/disputes/$id/resolve';
  static String adminDisputeNotify(String id) => '/admin/disputes/$id/notify';
  static String adminUserStatus(String id) => '/admin/users/$id/status';

  static String openDispute(String bookingId) => '/bookings/disputes';

  static String tripMessages(String id)     => '/trips/$id/messages';
  static String tripCoPassengers(String id) => '/trips/$id/co-passengers';
  static const earningsSummary  = '/drivers/earnings/summary';
  static const earningsTrips    = '/drivers/earnings/trips';
  static const driverWithdrawals = '/drivers/withdrawals';
  static const adminWithdrawals  = '/admin/withdrawals';
  static String adminWithdrawalById(String id) => '/admin/withdrawals/$id';
  static String tripLocation(String id) => '/trips/$id/location';
  static String tripLocationLatest(String id) => '/trips/$id/location/latest';

  static const stripeIntent = '/payments/stripe/intent';
  static String tripSos(String id) => '/trips/$id/sos';

  static const applyReferral = '/users/me/referral';
  static const uploadPhoto = '/upload/photo';

  static const notifications = '/notifications';
  static const notificationsUnreadCount = '/notifications/unread-count';
  static const notificationsReadAll = '/notifications/read-all';
}
