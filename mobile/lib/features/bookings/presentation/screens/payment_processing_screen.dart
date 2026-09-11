import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_endpoints.dart';

enum _PayState { waiting, confirmed, failed, timeout }

class PaymentProcessingScreen extends ConsumerStatefulWidget {
  final String bookingId;
  final String paymentUrl;

  const PaymentProcessingScreen({
    super.key,
    required this.bookingId,
    required this.paymentUrl,
  });

  @override
  ConsumerState<PaymentProcessingScreen> createState() =>
      _PaymentProcessingScreenState();
}

class _PaymentProcessingScreenState
    extends ConsumerState<PaymentProcessingScreen>
    with WidgetsBindingObserver {
  _PayState _state = _PayState.waiting;
  bool _polling = false;

  // Poll every 3 s for up to 5 minutes (100 attempts)
  static const _interval = Duration(seconds: 3);
  static const _maxAttempts = 100;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _openUrl();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // User returned from browser — start polling
    if (state == AppLifecycleState.resumed &&
        _state == _PayState.waiting &&
        !_polling) {
      _startPolling();
    }
  }

  Future<void> _openUrl() async {
    if (widget.paymentUrl.startsWith('mock://')) {
      // Mock mode: call backend to confirm immediately, then poll
      try {
        await ref
            .read(dioProvider)
            .post(Endpoints.bookingMockConfirm(widget.bookingId));
      } catch (_) {}
      if (mounted && !_polling) _startPolling();
      return;
    }
    final uri = Uri.parse(widget.paymentUrl);
    await launchUrl(uri, mode: LaunchMode.externalApplication);
    // Start polling immediately — don't wait for lifecycle events
    if (mounted && !_polling) _startPolling();
  }

  Future<void> _startPolling() async {
    if (_polling || _state != _PayState.waiting) return;
    _polling = true;

    for (var attempt = 0; attempt < _maxAttempts; attempt++) {
      if (!mounted || _state != _PayState.waiting) break;

      try {
        final res = await ref
            .read(dioProvider)
            .get(Endpoints.bookingById(widget.bookingId));
        final status = (res.data as Map<String, dynamic>)['status'] as String?;

        if (status == 'confirmed' || status == 'pending_driver_approval') {
          if (mounted) setState(() => _state = _PayState.confirmed);
          await Future.delayed(const Duration(seconds: 2));
          if (mounted) context.go('/my-bookings');
          return;
        }

        if (status == 'cancelled' || status == 'refunded') {
          if (mounted) setState(() => _state = _PayState.failed);
          _polling = false;
          return;
        }
      } catch (_) {
        // Network error — keep trying
      }

      await Future.delayed(_interval);
    }

    if (mounted && _state == _PayState.waiting) {
      setState(() => _state = _PayState.timeout);
    }
    _polling = false;
  }

  Future<void> _retryPoll() async {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('جاري التحقق من حالة الدفع...'),
          duration: Duration(seconds: 3),
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
    setState(() {
      _state = _PayState.waiting;
      _polling = false;
    });
    _startPolling();
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        if (_state == _PayState.confirmed) return;
        final leave = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('هل تريد المغادرة؟'),
            content: const Text(
                'الدفع لم يكتمل بعد. يمكنك مراجعة حجوزاتك لاحقاً.'),
            actions: [
              TextButton(
                  onPressed: () => Navigator.pop(ctx, false),
                  child: const Text('متابعة الدفع')),
              TextButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('مغادرة'),
              ),
            ],
          ),
        );
        if ((leave ?? false) && context.mounted) context.go('/my-bookings');
      },
      child: Scaffold(
        appBar: AppBar(
          title: const Text('تأكيد الدفع'),
          automaticallyImplyLeading: false,
        ),
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 32),
            child: switch (_state) {
              _PayState.waiting => _WaitingView(
                  onReopen: _openUrl,
                  onCheckNow: _retryPoll,
                ),
              _PayState.confirmed => const _ConfirmedView(),
              _PayState.timeout => _TimeoutView(
                  onRetry: _retryPoll,
                  onReopen: _openUrl,
                  onGoBookings: () => context.go('/my-bookings'),
                ),
              _PayState.failed => _FailedView(
                  onGoBookings: () => context.go('/my-bookings'),
                ),
            },
          ),
        ),
      ),
    );
  }
}

// ── State views ───────────────────────────────────────────────────────────────

class _WaitingView extends StatelessWidget {
  final VoidCallback onReopen;
  final VoidCallback onCheckNow;
  const _WaitingView({required this.onReopen, required this.onCheckNow});

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const SizedBox(
          width: 72,
          height: 72,
          child: CircularProgressIndicator(strokeWidth: 3),
        ),
        const SizedBox(height: 32),
        Text(
          'في انتظار تأكيد الدفع',
          style: Theme.of(context)
              .textTheme
              .titleLarge
              ?.copyWith(fontWeight: FontWeight.bold),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 12),
        Text(
          'أكمل عملية الدفع في المتصفح وسيتم تأكيد حجزك تلقائياً.',
          style: TextStyle(color: Colors.grey.shade600, height: 1.5),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 40),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            icon: const Icon(Icons.open_in_browser_rounded),
            label: const Text('إعادة فتح صفحة الدفع'),
            onPressed: onReopen,
          ),
        ),
        const SizedBox(height: 12),
        SizedBox(
          width: double.infinity,
          child: TextButton(
            onPressed: onCheckNow,
            child: const Text('تحققت من الدفع — تحقق الآن'),
          ),
        ),
      ],
    );
  }
}

class _ConfirmedView extends StatelessWidget {
  const _ConfirmedView();

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Container(
          width: 96,
          height: 96,
          decoration: const BoxDecoration(
            color: Colors.green,
            shape: BoxShape.circle,
          ),
          child: const Icon(Icons.check_rounded, color: Colors.white, size: 56),
        ),
        const SizedBox(height: 24),
        Text(
          'تم الحجز بنجاح!',
          style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.bold,
                color: Colors.green,
              ),
        ),
        const SizedBox(height: 8),
        Text(
          'جاري الانتقال إلى حجوزاتك...',
          style: TextStyle(color: Colors.grey.shade600),
        ),
      ],
    );
  }
}

class _TimeoutView extends StatelessWidget {
  final VoidCallback onRetry;
  final VoidCallback onReopen;
  final VoidCallback onGoBookings;
  const _TimeoutView(
      {required this.onRetry,
      required this.onReopen,
      required this.onGoBookings});

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(Icons.hourglass_bottom_rounded,
            size: 72, color: Colors.orange.shade400),
        const SizedBox(height: 24),
        Text(
          'لم يتم تأكيد الدفع بعد',
          style: Theme.of(context)
              .textTheme
              .titleLarge
              ?.copyWith(fontWeight: FontWeight.bold),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 12),
        Text(
          'إذا أتممت الدفع، قد يستغرق التأكيد بضع دقائق. تحقق من حجوزاتك.',
          style: TextStyle(color: Colors.grey.shade600, height: 1.5),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 40),
        SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            icon: const Icon(Icons.refresh_rounded),
            label: const Text('تحقق مجدداً'),
            onPressed: onRetry,
          ),
        ),
        const SizedBox(height: 12),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            icon: const Icon(Icons.open_in_browser_rounded),
            label: const Text('إعادة فتح صفحة الدفع'),
            onPressed: onReopen,
          ),
        ),
        const SizedBox(height: 12),
        TextButton(
          onPressed: onGoBookings,
          child: const Text('عرض حجوزاتي'),
        ),
      ],
    );
  }
}

class _FailedView extends StatelessWidget {
  final VoidCallback onGoBookings;
  const _FailedView({required this.onGoBookings});

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const Icon(Icons.cancel_rounded, size: 72, color: Colors.red),
        const SizedBox(height: 24),
        Text(
          'تم إلغاء الدفع',
          style: Theme.of(context)
              .textTheme
              .titleLarge
              ?.copyWith(fontWeight: FontWeight.bold, color: Colors.red),
        ),
        const SizedBox(height: 12),
        Text(
          'لم يتم الحجز. يمكنك المحاولة مجدداً من شاشة البحث.',
          style: TextStyle(color: Colors.grey.shade600, height: 1.5),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 40),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            onPressed: onGoBookings,
            child: const Text('عرض حجوزاتي'),
          ),
        ),
      ],
    );
  }
}
