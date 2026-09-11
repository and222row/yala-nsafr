import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../features/auth/providers/auth_provider.dart';
import '../../features/auth/presentation/screens/phone_screen.dart';
import '../../features/auth/presentation/screens/otp_screen.dart';
import '../../features/auth/presentation/screens/profile_setup_screen.dart';
import '../../features/trips/presentation/screens/search_screen.dart';
import '../../features/trips/presentation/screens/trip_results_screen.dart';
import '../../features/trips/presentation/screens/trip_detail_screen.dart';
import '../../features/trips/presentation/screens/post_trip_screen.dart';
import '../../features/trips/presentation/screens/my_trips_screen.dart';
import '../../features/bookings/presentation/screens/booking_confirm_screen.dart';
import '../../features/bookings/presentation/screens/my_bookings_screen.dart';
import '../../features/bookings/presentation/screens/payment_processing_screen.dart';
import '../../features/bookings/presentation/screens/kashier_webview_screen.dart';
import '../../features/profile/presentation/screens/profile_screen.dart';
import '../../features/profile/presentation/screens/edit_profile_screen.dart';
import '../../features/profile/presentation/screens/id_verification_screen.dart';
import '../../features/profile/presentation/screens/driver_verification_screen.dart';
import '../../features/profile/presentation/screens/user_public_profile_screen.dart';
import '../../features/disputes/presentation/screens/disputes_screen.dart';
import '../../features/disputes/presentation/screens/dispute_detail_screen.dart';
import '../../features/disputes/presentation/screens/open_dispute_screen.dart';
import '../../features/admin/presentation/screens/admin_dashboard_screen.dart';
import '../../features/admin/presentation/screens/admin_disputes_screen.dart';
import '../../features/admin/presentation/screens/admin_dispute_detail_screen.dart';
import '../../features/admin/presentation/screens/admin_users_screen.dart';
import '../../features/admin/presentation/screens/admin_trips_screen.dart';
import '../../features/admin/presentation/screens/admin_config_screen.dart';
import '../../features/admin/presentation/screens/admin_withdrawals_screen.dart';
import '../../features/ratings/presentation/screens/rate_screen.dart';
import '../../features/trips/presentation/screens/trip_passengers_screen.dart';
import '../../features/trips/presentation/screens/track_trip_screen.dart';
import '../../features/trips/presentation/screens/trip_chat_screen.dart';
import '../../features/earnings/presentation/screens/driver_earnings_screen.dart';
import '../../features/notifications/presentation/screens/notifications_inbox_screen.dart';
import '../../features/onboarding/presentation/screens/onboarding_screen.dart';
import '../../features/subscriptions/presentation/screens/subscription_screen.dart';
import '../models/booking.dart';
import '../models/trip.dart';
import '../../shared/widgets/main_shell.dart';

// Public so FcmService can call navigateFromNotification()
final appNavigatorKey = GlobalKey<NavigatorState>();
final _shellNavigatorKey = GlobalKey<NavigatorState>();

GoRouter? _routerRef;

/// Navigates using the app router without a BuildContext.
/// Safe to call any time after the router has been created.
void navigateFromNotification(String route, {Object? extra}) {
  _routerRef?.push<void>(route, extra: extra);
}

class _RouterNotifier extends ChangeNotifier {
  final Ref _ref;
  _RouterNotifier(this._ref) {
    _ref.listen<AuthState>(authProvider, (_, __) => notifyListeners());
  }
  AuthState get auth => _ref.read(authProvider);
}

final routerProvider = Provider<GoRouter>((ref) {
  final notifier = _RouterNotifier(ref);

  _routerRef = GoRouter(
    navigatorKey: appNavigatorKey,
    initialLocation: '/search',
    refreshListenable: notifier,
    redirect: (context, state) {
      final status = notifier.auth.status;
      final location = state.uri.path;

      if (status == AuthStatus.unknown) return null;

      final isOnAuth = location.startsWith('/auth');

      if (status == AuthStatus.unauthenticated && !isOnAuth) {
        return '/auth/phone';
      }

      if (status == AuthStatus.authenticated) {
        final seen = notifier.auth.onboardingSeen;
        // Leaving auth flow — go to onboarding if not yet seen, else search
        if (isOnAuth) return seen ? '/search' : '/onboarding';
        // Already in app — ensure onboarding is seen before any other screen
        if (!seen && location != '/onboarding') return '/onboarding';
        // Admin guard — non-admins cannot access /admin routes
        if (location.startsWith('/admin') &&
            notifier.auth.user?.role != 'admin') {
          return '/search';
        }
      }

      return null;
    },
    routes: [
      // ── Auth ───────────────────────────────────────────────────────────────
      GoRoute(
        path: '/auth/phone',
        builder: (_, __) => const PhoneScreen(),
      ),
      GoRoute(
        path: '/auth/otp',
        builder: (_, state) => OtpScreen(phone: state.uri.queryParameters['phone'] ?? ''),
      ),
      GoRoute(
        path: '/auth/setup',
        builder: (_, __) => const ProfileSetupScreen(),
      ),

      // ── Main shell (bottom nav) ────────────────────────────────────────────
      ShellRoute(
        navigatorKey: _shellNavigatorKey,
        builder: (_, __, child) => MainShell(child: child),
        routes: [
          GoRoute(
            path: '/search',
            builder: (_, __) => const SearchScreen(),
          ),
          GoRoute(
            path: '/my-bookings',
            builder: (_, __) => const MyBookingsScreen(),
          ),
          GoRoute(
            path: '/my-trips',
            builder: (_, __) => const MyTripsScreen(),
          ),
          GoRoute(
            path: '/profile',
            builder: (_, __) => const ProfileScreen(),
          ),
        ],
      ),

      // ── Trips ─────────────────────────────────────────────────────────────
      // Static paths must come before dynamic /:id to avoid mis-matching
      GoRoute(
        path: '/trips/results',
        builder: (_, state) {
          final extra = state.extra as TripSearchParams;
          return TripResultsScreen(params: extra);
        },
      ),
      GoRoute(
        path: '/trips/post',
        builder: (_, __) => const PostTripScreen(),
      ),
      GoRoute(
        path: '/trips/:id/edit',
        builder: (_, state) {
          final trip = state.extra as Trip;
          return PostTripScreen(editTrip: trip);
        },
      ),
      GoRoute(
        path: '/trips/:id/passengers',
        builder: (_, state) =>
            TripPassengersScreen(tripId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/trips/:id/live',
        builder: (_, state) {
          final extra = (state.extra as Map<String, dynamic>?) ?? {};
          return TrackTripScreen(
            tripId: state.pathParameters['id']!,
            isDriver: extra['isDriver'] as bool? ?? false,
          );
        },
      ),
      GoRoute(
        path: '/trips/:id/chat',
        builder: (_, state) {
          final extra = (state.extra as Map<String, dynamic>?) ?? {};
          return TripChatScreen(
            tripId: state.pathParameters['id']!,
            tripLabel: extra['label'] as String? ?? '',
          );
        },
      ),
      GoRoute(
        path: '/trips/:id',
        builder: (_, state) => TripDetailScreen(tripId: state.pathParameters['id']!),
      ),

      // ── Bookings ───────────────────────────────────────────────────────────
      GoRoute(
        path: '/bookings/confirm',
        builder: (_, state) {
          final extra = state.extra as Map<String, dynamic>;
          return BookingConfirmScreen(
            trip: extra['trip'] as Trip,
            initialSeats: extra['seats'] as int? ?? 1,
          );
        },
      ),
      GoRoute(
        path: '/bookings/payment',
        builder: (_, state) {
          final extra = state.extra as Map<String, dynamic>;
          final paymentUrl = extra['paymentUrl'] as String;
          // Mock payments still use the old polling screen; real Kashier uses WebView
          if (paymentUrl.startsWith('mock://')) {
            return PaymentProcessingScreen(
              bookingId: extra['bookingId'] as String,
              paymentUrl: paymentUrl,
            );
          }
          return KashierWebViewScreen(
            bookingId: extra['bookingId'] as String,
            paymentUrl: paymentUrl,
          );
        },
      ),
      GoRoute(
        path: '/bookings/rate',
        builder: (_, state) => RateScreen(booking: state.extra as Booking),
      ),

      // ── Profile ────────────────────────────────────────────────────────────
      GoRoute(
        path: '/users/:id',
        builder: (_, state) =>
            UserPublicProfileScreen(userId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/profile/edit',
        builder: (_, __) => const EditProfileScreen(),
      ),
      GoRoute(
        path: '/profile/id-verification',
        builder: (_, __) => const IdVerificationScreen(),
      ),
      GoRoute(
        path: '/profile/driver-verification',
        builder: (_, __) => const DriverVerificationScreen(),
      ),

      // ── Disputes ───────────────────────────────────────────────────────────
      GoRoute(
        path: '/disputes',
        builder: (_, __) => const DisputesScreen(),
      ),
      GoRoute(
        path: '/disputes/open',
        builder: (_, state) => OpenDisputeScreen(
          bookingId: state.uri.queryParameters['bookingId'] ?? '',
          role: state.uri.queryParameters['role'] ?? 'passenger',
        ),
      ),
      GoRoute(
        path: '/disputes/:id',
        builder: (_, state) => DisputeDetailScreen(disputeId: state.pathParameters['id']!),
      ),

      // ── Onboarding ────────────────────────────────────────────────────────────
      GoRoute(
        path: '/onboarding',
        builder: (_, __) => const OnboardingScreen(),
      ),

      // ── Notifications ─────────────────────────────────────────────────────────
      GoRoute(
        path: '/notifications',
        builder: (_, __) => const NotificationsInboxScreen(),
      ),

      // ── Subscription ──────────────────────────────────────────────────────────
      GoRoute(
        path: '/subscription',
        builder: (_, __) => const SubscriptionScreen(),
      ),

      // ── Earnings ──────────────────────────────────────────────────────────────
      GoRoute(
        path: '/drivers/earnings',
        builder: (_, __) => const DriverEarningsScreen(),
      ),

      // ── Admin ───────────────────────────────────────────────────────────────
      GoRoute(
        path: '/admin',
        builder: (_, __) => const AdminDashboardScreen(),
      ),
      GoRoute(
        path: '/admin/users',
        builder: (_, __) => const AdminUsersScreen(),
      ),
      GoRoute(
        path: '/admin/trips',
        builder: (_, __) => const AdminTripsScreen(),
      ),
      GoRoute(
        path: '/admin/config',
        builder: (_, __) => const AdminConfigScreen(),
      ),
      GoRoute(
        path: '/admin/withdrawals',
        builder: (_, __) => const AdminWithdrawalsScreen(),
      ),
      GoRoute(
        path: '/admin/disputes',
        builder: (_, __) => const AdminDisputesScreen(),
      ),
      GoRoute(
        path: '/admin/disputes/:id',
        builder: (_, state) =>
            AdminDisputeDetailScreen(disputeId: state.pathParameters['id']!),
      ),
    ],
  );
  return _routerRef!;
});
