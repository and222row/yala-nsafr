import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

const _baseUrl = 'http://localhost:3000/api/v1';

const _tokenKey = 'auth_token';
const _refreshTokenKey = 'refresh_token';
const _onboardingKey = 'onboarding_seen';

// Incrementing this counter signals the auth notifier to force sign-out.
// Defined here (not in auth_provider.dart) to avoid a circular import.
final forceLogoutCounterProvider = StateProvider<int>((ref) => 0);

final secureStorageProvider = Provider<FlutterSecureStorage>((ref) {
  return const FlutterSecureStorage();
});

final tokenStorageProvider = Provider<TokenStorage>((ref) {
  return TokenStorage(ref.read(secureStorageProvider));
});

class TokenStorage {
  final FlutterSecureStorage _storage;
  TokenStorage(this._storage);

  Future<void> save(String token) => _storage.write(key: _tokenKey, value: token);
  Future<String?> read() => _storage.read(key: _tokenKey);
  Future<void> delete() => _storage.delete(key: _tokenKey);

  Future<void> saveRefreshToken(String token) =>
      _storage.write(key: _refreshTokenKey, value: token);
  Future<String?> readRefreshToken() => _storage.read(key: _refreshTokenKey);

  Future<void> deleteAll() async {
    await _storage.delete(key: _tokenKey);
    await _storage.delete(key: _refreshTokenKey);
  }
}

/// Plain Dio used only for the token refresh call, so it never re-enters the
/// interceptor below. Separate provider so tests can drive the refresh response.
final refreshDioProvider = Provider<Dio>((ref) {
  return Dio(BaseOptions(
    baseUrl: _baseUrl,
    headers: {'Content-Type': 'application/json'},
  ));
});

final dioProvider = Provider<Dio>((ref) {
  final tokenStorage = ref.read(tokenStorageProvider);

  final dio = Dio(BaseOptions(
    baseUrl: _baseUrl,
    connectTimeout: const Duration(seconds: 15),
    receiveTimeout: const Duration(seconds: 90),
    headers: {'Content-Type': 'application/json'},
  ));

  bool isRefreshing = false;
  Completer<void>? refreshCompleter;

  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await tokenStorage.read();
        if (token != null) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        handler.next(options);
      },
      onError: (error, handler) async {
        final statusCode = error.response?.statusCode;
        final path = error.requestOptions.path;

        // Only handle 401s that are not from the auth endpoints themselves
        if (statusCode != 401 ||
            path.contains('/auth/refresh') ||
            path.contains('/auth/otp') ||
            path.contains('/auth/logout')) {
          return handler.next(error);
        }

        // A refresh is already in progress — queue this request behind it
        if (isRefreshing) {
          try {
            await refreshCompleter!.future;
            final token = await tokenStorage.read();
            error.requestOptions.headers['Authorization'] = 'Bearer $token';
            final response = await dio.fetch(error.requestOptions);
            return handler.resolve(response);
          } catch (_) {
            return handler.next(error);
          }
        }

        // Acquire the refresh lock before the first await
        isRefreshing = true;
        refreshCompleter = Completer<void>();
        // completeError below has no listener when nothing is queued behind the
        // refresh, which would surface as an unhandled async error. Real waiters
        // still receive the error; this only stops it going nowhere.
        unawaited(refreshCompleter!.future.catchError((_) {}));

        // Only the refresh itself is guarded here. Replaying the original request used
        // to sit inside this try, so a failed replay ran the refresh-failure handler:
        // it called completeError on an already-completed completer, which threw a
        // StateError that skipped releasing the lock and calling the handler — leaving
        // isRefreshing stuck true forever and the caller's future never settled. It also
        // deleted tokens that had just been minted successfully.
        final String newAccess;
        try {
          final rawRefreshToken = await tokenStorage.readRefreshToken();
          if (rawRefreshToken == null) throw Exception('No refresh token stored');

          // A plain Dio instance, so this does not go through the interceptor again
          final refreshDio = ref.read(refreshDioProvider);
          final res = await refreshDio.post(
            '/auth/refresh',
            data: {'refreshToken': rawRefreshToken},
          );

          newAccess = res.data['accessToken'] as String;
          final newRefresh = res.data['refreshToken'] as String;
          await tokenStorage.save(newAccess);
          await tokenStorage.saveRefreshToken(newRefresh);
        } catch (e) {
          // The refresh genuinely failed, so the session is gone
          await tokenStorage.deleteAll();
          if (!refreshCompleter!.isCompleted) refreshCompleter!.completeError(e);
          isRefreshing = false;
          // Signal the auth notifier to transition to unauthenticated
          ref.read(forceLogoutCounterProvider.notifier).state++;
          return handler.next(error);
        }

        // Release the lock and wake queued requests before replaying, so a slow or
        // failing replay cannot hold up every other request waiting on the refresh.
        if (!refreshCompleter!.isCompleted) refreshCompleter!.complete();
        isRefreshing = false;

        try {
          error.requestOptions.headers['Authorization'] = 'Bearer $newAccess';
          final retryResponse = await dio.fetch(error.requestOptions);
          return handler.resolve(retryResponse);
        } catch (_) {
          // The session is still valid — surface the failure without logging out
          return handler.next(error);
        }
      },
    ),
  );

  return dio;
});

final onboardingStorageProvider = Provider<OnboardingStorage>((ref) {
  return OnboardingStorage(ref.read(secureStorageProvider));
});

class OnboardingStorage {
  final FlutterSecureStorage _storage;
  OnboardingStorage(this._storage);

  Future<bool> read() async {
    final val = await _storage.read(key: _onboardingKey);
    return val == 'true';
  }

  Future<void> markSeen() =>
      _storage.write(key: _onboardingKey, value: 'true');
}

class ApiException implements Exception {
  final String message;
  final int? statusCode;
  ApiException(this.message, {this.statusCode});

  @override
  String toString() => message;

  factory ApiException.fromDioError(DioException e) {
    if (e.type == DioExceptionType.connectionError ||
        e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.sendTimeout ||
        e.type == DioExceptionType.receiveTimeout) {
      return ApiException('لا يوجد اتصال بالإنترنت');
    }
    final data = e.response?.data;
    String message = 'حدث خطأ غير متوقع';
    if (data is Map && data['message'] != null) {
      final msg = data['message'];
      message = msg is List ? msg.first.toString() : msg.toString();
    }
    return ApiException(message, statusCode: e.response?.statusCode);
  }
}
