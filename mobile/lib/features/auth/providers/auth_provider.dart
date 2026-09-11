import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../../../core/api/api_client.dart';
import '../../../core/api/api_endpoints.dart';
import '../../../core/models/user.dart';
import '../../../core/services/fcm_token_uploader.dart';
import '../../../core/services/analytics_service.dart';

enum AuthStatus { unknown, authenticated, unauthenticated }

class AuthState {
  final AuthStatus status;
  final User? user;
  final bool onboardingSeen;

  const AuthState({
    required this.status,
    this.user,
    this.onboardingSeen = true,
  });

  AuthState copyWith({AuthStatus? status, User? user, bool? onboardingSeen}) =>
      AuthState(
        status: status ?? this.status,
        user: user ?? this.user,
        onboardingSeen: onboardingSeen ?? this.onboardingSeen,
      );
}

class AuthNotifier extends StateNotifier<AuthState> {
  final Dio _dio;
  final TokenStorage _token;
  final OnboardingStorage _onboarding;
  final Ref _ref;

  AuthNotifier(this._dio, this._token, this._onboarding, this._ref)
      : super(const AuthState(status: AuthStatus.unknown)) {
    _init();
  }

  Future<void> _init() async {
    final token = await _token.read();
    if (token == null) {
      final seen = await _onboarding.read();
      state = AuthState(status: AuthStatus.unauthenticated, onboardingSeen: seen);
      return;
    }
    try {
      final res = await _dio.get(Endpoints.me);
      final user = User.fromJson(res.data as Map<String, dynamic>);

      bool seen = await _onboarding.read();
      if (!seen &&
          (user.completedTripsAsPassenger > 0 ||
              user.completedTripsAsDriver > 0)) {
        await _onboarding.markSeen();
        seen = true;
      }

      state = AuthState(
        status: AuthStatus.authenticated,
        user: user,
        onboardingSeen: seen,
      );
      uploadFcmToken(_ref);
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status == 401 || status == 403) {
        await _token.deleteAll();
      }
      state = const AuthState(status: AuthStatus.unauthenticated);
    } catch (_) {
      state = const AuthState(status: AuthStatus.unauthenticated);
    }
  }

  Future<void> sendOtp(String phoneNumber) async {
    try {
      await _dio.post(Endpoints.otpSend, data: {'phoneNumber': phoneNumber});
    } on DioException catch (e) {
      throw ApiException.fromDioError(e);
    }
  }

  Future<bool> verifyOtp(String phoneNumber, String code) async {
    try {
      final res = await _dio.post(
        Endpoints.otpVerify,
        data: {'phoneNumber': phoneNumber, 'code': code},
      );
      final data = res.data as Map<String, dynamic>;
      await _token.save(data['accessToken'] as String);
      final refreshToken = data['refreshToken'] as String?;
      if (refreshToken != null) await _token.saveRefreshToken(refreshToken);

      final isNewUser = data['isNewUser'] as bool? ?? false;
      if (!isNewUser) {
        AnalyticsService.logLogin().ignore();
        await _init();
      } else {
        state = const AuthState(status: AuthStatus.unauthenticated);
      }
      return isNewUser;
    } on DioException catch (e) {
      throw ApiException.fromDioError(e);
    }
  }

  Future<void> updateProfile(Map<String, dynamic> body) async {
    try {
      final res = await _dio.patch(Endpoints.me, data: body);
      final user = User.fromJson(res.data as Map<String, dynamic>);
      state = state.copyWith(status: AuthStatus.authenticated, user: user);
      uploadFcmToken(_ref);
    } on DioException catch (e) {
      throw ApiException.fromDioError(e);
    }
  }

  Future<void> markOnboardingSeen() async {
    await _onboarding.markSeen();
    state = state.copyWith(onboardingSeen: true);
  }

  Future<void> refreshUser() async {
    try {
      final res = await _dio.get(Endpoints.me);
      final user = User.fromJson(res.data as Map<String, dynamic>);
      state = state.copyWith(user: user);
    } catch (_) {}
  }

  Future<void> signOut() async {
    try {
      final refreshToken = await _token.readRefreshToken();
      if (refreshToken != null) {
        await _dio.post(
          Endpoints.authLogout,
          data: {'refreshToken': refreshToken},
        );
      }
    } catch (_) {} // best-effort: invalidate on server
    await _token.deleteAll();
    state = const AuthState(status: AuthStatus.unauthenticated);
  }

  // Called by the Dio interceptor when a token refresh fails
  void forceSignOut() {
    state = const AuthState(status: AuthStatus.unauthenticated);
  }
}

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  final notifier = AuthNotifier(
    ref.read(dioProvider),
    ref.read(tokenStorageProvider),
    ref.read(onboardingStorageProvider),
    ref,
  );
  // When the Dio refresh interceptor signals failure, immediately sign out
  ref.listen(forceLogoutCounterProvider, (prev, next) {
    if (prev != null && next > prev) notifier.forceSignOut();
  });
  return notifier;
});
