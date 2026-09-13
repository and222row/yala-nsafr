import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yala_nsafr/core/api/api_client.dart';

/// In-memory tokens. The real implementation talks to the platform keystore, which
/// is unavailable under `flutter test`; every method used by the interceptor is
/// overridden, so the FlutterSecureStorage passed to super is never touched.
class _FakeTokenStorage extends TokenStorage {
  _FakeTokenStorage() : super(const FlutterSecureStorage());

  String? access = 'expired-access';
  String? refresh = 'valid-refresh';
  bool deletedAll = false;

  @override
  Future<void> save(String token) async => access = token;
  @override
  Future<String?> read() async => access;
  @override
  Future<void> delete() async => access = null;
  @override
  Future<void> saveRefreshToken(String token) async => refresh = token;
  @override
  Future<String?> readRefreshToken() async => refresh;
  @override
  Future<void> deleteAll() async {
    deletedAll = true;
    access = null;
    refresh = null;
  }
}

class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.onFetch);
  final Future<ResponseBody> Function(RequestOptions options) onFetch;

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) =>
      onFetch(options);
}

ResponseBody _json(Map<String, dynamic> body, int status) => ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );

void main() {
  late _FakeTokenStorage storage;
  late ProviderContainer container;
  late int refreshCalls;

  /// [onProtected] drives the protected endpoint; the refresh endpoint is driven by
  /// [refreshSucceeds].
  void build({
    required bool refreshSucceeds,
    required Future<ResponseBody> Function(int attempt) onProtected,
  }) {
    storage = _FakeTokenStorage();
    refreshCalls = 0;
    var protectedAttempts = 0;

    final refreshDio = Dio(BaseOptions(baseUrl: 'http://localhost:3000/api/v1'))
      ..httpClientAdapter = _FakeAdapter((options) async {
        refreshCalls++;
        if (!refreshSucceeds) {
          return _json({'message': 'invalid refresh token'}, 401);
        }
        return _json(
          {'accessToken': 'fresh-access', 'refreshToken': 'fresh-refresh'},
          200,
        );
      });

    container = ProviderContainer(overrides: [
      tokenStorageProvider.overrideWithValue(storage),
      refreshDioProvider.overrideWithValue(refreshDio),
    ]);

    container.read(dioProvider).httpClientAdapter =
        _FakeAdapter((options) async => onProtected(++protectedAttempts));
  }

  tearDown(() => container.dispose());

  test('refresh succeeds and the replayed request succeeds', () async {
    build(
      refreshSucceeds: true,
      onProtected: (attempt) async => attempt == 1
          ? _json({'message': 'expired'}, 401)
          : _json({'ok': true}, 200),
    );

    final res = await container.read(dioProvider).get('/trips');

    expect(res.statusCode, 200);
    expect(storage.access, 'fresh-access');
    expect(storage.deletedAll, isFalse);
    expect(container.read(forceLogoutCounterProvider), 0);
  });

  // Regression: the replay used to sit inside the refresh try/catch, so a failed
  // replay ran the refresh-failure handler — calling completeError on an already
  // completed completer. The resulting StateError skipped releasing the lock and
  // calling the handler, wedging every later refresh.
  test('a failed replay after a successful refresh does not log the user out', () async {
    build(
      refreshSucceeds: true,
      // 401 first, then the replay fails with a server error
      onProtected: (attempt) async => attempt == 1
          ? _json({'message': 'expired'}, 401)
          : _json({'message': 'boom'}, 500),
    );

    await expectLater(
      container.read(dioProvider).get('/trips'),
      throwsA(isA<DioException>()),
    );

    // The refresh worked, so the new tokens must survive
    expect(storage.access, 'fresh-access');
    expect(storage.refresh, 'fresh-refresh');
    expect(storage.deletedAll, isFalse);
    expect(container.read(forceLogoutCounterProvider), 0);
  });

  test('the refresh lock is released after a failed replay, so refresh can run again',
      () async {
    build(
      refreshSucceeds: true,
      onProtected: (attempt) async => switch (attempt) {
        1 => _json({'message': 'expired'}, 401), // triggers refresh #1
        2 => _json({'message': 'boom'}, 500), // replay fails
        3 => _json({'message': 'expired'}, 401), // triggers refresh #2
        _ => _json({'ok': true}, 200),
      },
    );

    await expectLater(
      container.read(dioProvider).get('/trips'),
      throwsA(isA<DioException>()),
    );
    // Previously isRefreshing was left true here and this second refresh never ran
    final second = await container.read(dioProvider).get('/trips');

    expect(second.statusCode, 200);
    expect(refreshCalls, 2);
  });

  test('a genuinely failed refresh clears tokens and forces logout', () async {
    build(
      refreshSucceeds: false,
      onProtected: (attempt) async => _json({'message': 'expired'}, 401),
    );

    await expectLater(
      container.read(dioProvider).get('/trips'),
      throwsA(isA<DioException>()),
    );

    expect(storage.deletedAll, isTrue);
    expect(storage.access, isNull);
    expect(container.read(forceLogoutCounterProvider), 1);
  });
}
