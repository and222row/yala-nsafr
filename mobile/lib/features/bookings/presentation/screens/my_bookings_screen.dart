import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_endpoints.dart';
import '../../../../core/models/booking.dart';
import '../../../../core/theme/app_theme.dart';
import '../../providers/bookings_provider.dart';
import '../../../../shared/widgets/skeletons.dart';
import '../../../../shared/widgets/trip_badge_row.dart';

// ── Cancel booking dialog ─────────────────────────────────────────────────────

Future<bool> _showCancelDialog(
    BuildContext context, WidgetRef ref, Booking booking) async {
  Map<String, dynamic>? preview;
  bool loading = true;
  String? fetchError;

  bool cancelled = false;

  await showDialog(
    context: context,
    barrierDismissible: false,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) {
        if (loading) {
          fetchCancelPreview(ref, booking.id).then((p) {
            if (ctx.mounted) setState(() { preview = p; loading = false; });
          }).catchError((e) {
            if (ctx.mounted) setState(() { fetchError = '$e'; loading = false; });
          });
        }

        if (loading) {
          return const AlertDialog(
            content: Padding(
              padding: EdgeInsets.all(20),
              child: Center(child: CircularProgressIndicator()),
            ),
          );
        }

        if (fetchError != null || preview == null) {
          return AlertDialog(
            title: const Text('خطأ'),
            content: Text(fetchError ?? 'تعذّر جلب تفاصيل الإلغاء'),
            actions: [
              TextButton(
                  onPressed: () => Navigator.pop(ctx),
                  child: const Text('حسناً')),
            ],
          );
        }

        final policy = preview!['policy'] as String? ?? 'free_cancel';
        final refund = double.tryParse(preview!['refundAmount']?.toString() ?? '') ?? 0;
        final fee = double.tryParse(preview!['cancellationFee']?.toString() ?? '') ?? 0;
        final total = double.tryParse(preview!['totalAmount']?.toString() ?? '') ?? 0;
        final isCash = preview!['isCash'] as bool? ?? false;
        final canCancel = preview!['canCancel'] as bool? ?? false;

        if (!canCancel) {
          return AlertDialog(
            title: const Text('لا يمكن الإلغاء'),
            content:
                const Text('لا يمكن إلغاء هذا الحجز في الوقت الحالي.'),
            actions: [
              TextButton(
                  onPressed: () => Navigator.pop(ctx),
                  child: const Text('حسناً')),
            ],
          );
        }

        Widget refundInfo;
        if (isCash) {
          refundInfo = const _RefundBanner(
            color: Colors.green,
            icon: Icons.check_circle_outline_rounded,
            title: 'إلغاء مجاني',
            body: 'دفع نقدي — لا توجد رسوم إلغاء',
          );
        } else if (policy == 'free_cancel') {
          refundInfo = _RefundBanner(
            color: Colors.green,
            icon: Icons.check_circle_outline_rounded,
            title: 'استرداد كامل',
            body: 'ستسترد ${total.toStringAsFixed(0)} جنيه كاملاً',
          );
        } else if (policy == 'late_cancel') {
          refundInfo = _RefundBanner(
            color: Colors.orange,
            icon: Icons.info_outline_rounded,
            title: 'إلغاء متأخر',
            body: 'ستسترد ${refund.toStringAsFixed(0)} جنيه'
                '\nرسوم الإلغاء: ${fee.toStringAsFixed(0)} جنيه',
          );
        } else {
          refundInfo = const _RefundBanner(
            color: Colors.red,
            icon: Icons.cancel_outlined,
            title: 'لا يوجد استرداد',
            body: 'أقل من ساعتين من انطلاق الرحلة\nلن تسترد أي مبلغ',
          );
        }

        bool confirming = false;
        return StatefulBuilder(builder: (ctx2, setState2) {
          return AlertDialog(
            title: const Text('إلغاء الحجز'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                refundInfo,
                const SizedBox(height: 8),
                const Text('هل أنت متأكد أنك تريد إلغاء هذا الحجز؟',
                    style: TextStyle(fontSize: 14)),
              ],
            ),
            actions: [
              TextButton(
                onPressed: confirming ? null : () => Navigator.pop(ctx),
                child: const Text('تراجع'),
              ),
              FilledButton(
                style:
                    FilledButton.styleFrom(backgroundColor: Colors.red),
                onPressed: confirming
                    ? null
                    : () async {
                        setState2(() => confirming = true);
                        try {
                          await cancelBooking(ref, booking.id);
                          cancelled = true;
                          if (ctx.mounted) Navigator.pop(ctx, true);
                        } catch (e) {
                          if (ctx.mounted) {
                            setState2(() => confirming = false);
                            ScaffoldMessenger.of(ctx).showSnackBar(
                              SnackBar(content: Text('$e')),
                            );
                          }
                        }
                      },
                child: confirming
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : const Text('تأكيد الإلغاء'),
              ),
            ],
          );
        });
      },
    ),
  );

  return cancelled;
}

// ── Screen ────────────────────────────────────────────────────────────────────

class MyBookingsScreen extends ConsumerStatefulWidget {
  const MyBookingsScreen({super.key});

  @override
  ConsumerState<MyBookingsScreen> createState() => _MyBookingsScreenState();
}

class _MyBookingsScreenState extends ConsumerState<MyBookingsScreen> {
  static const _limit = 20;

  int _page = 1;
  List<Booking> _bookings = [];
  int _total = 0;
  bool _loading = false;
  bool _initialLoad = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool reset = false}) async {
    if (reset) _page = 1;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await ref.read(dioProvider).get(
        Endpoints.myBookings,
        queryParameters: {'page': _page, 'limit': _limit},
      );
      final body = res.data;
      final list = body is Map
          ? (body['data'] as List? ?? [])
          : body as List;
      final total = body is Map
          ? (body['total'] as num?)?.toInt() ?? 0
          : list.length;
      final incoming = list
          .map((e) => Booking.fromJson(e as Map<String, dynamic>))
          .toList();
      setState(() {
        _bookings = reset ? incoming : [..._bookings, ...incoming];
        _total = total;
        _initialLoad = false;
      });
    } catch (e) {
      setState(() {
        _error = '$e';
        _initialLoad = false;
      });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  bool get _hasMore => _bookings.length < _total;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('حجوزاتي')),
      body: _initialLoad
          ? SkeletonCardList(itemBuilder: () => const ListCardSkeleton())
          : _error != null && _bookings.isEmpty
              ? Center(child: Text(_error!))
              : _bookings.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 40),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.book_online_outlined,
                                size: 80, color: Colors.grey.shade300),
                            const SizedBox(height: 16),
                            const Text('لا توجد حجوزات بعد',
                                style: TextStyle(
                                    fontSize: 17,
                                    fontWeight: FontWeight.w600,
                                    color: Colors.grey)),
                            const SizedBox(height: 8),
                            Text(
                              'ابحث عن رحلة وحجز مقعدك بكل سهولة',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                  fontSize: 13, color: Colors.grey[400]),
                            ),
                            const SizedBox(height: 24),
                            FilledButton.icon(
                              icon: const Icon(Icons.search_rounded),
                              label: const Text('ابحث عن رحلة'),
                              onPressed: () => context.go('/search'),
                            ),
                          ],
                        ),
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: () => _load(reset: true),
                      child: ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount:
                            _bookings.length + (_hasMore || _loading ? 1 : 0),
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (_, i) {
                          if (i == _bookings.length) {
                            return _loading
                                ? const Center(
                                    child: Padding(
                                      padding: EdgeInsets.all(16),
                                      child: CircularProgressIndicator(),
                                    ),
                                  )
                                : Center(
                                    child: TextButton(
                                      onPressed: () {
                                        setState(() => _page++);
                                        _load();
                                      },
                                      child: const Text('تحميل المزيد'),
                                    ),
                                  );
                          }
                          return _BookingCard(
                            booking: _bookings[i],
                            onRefresh: () => _load(reset: true),
                          );
                        },
                      ),
                    ),
    );
  }
}

// ── Refund banner ─────────────────────────────────────────────────────────────

class _RefundBanner extends StatelessWidget {
  final Color color;
  final IconData icon;
  final String title;
  final String body;
  const _RefundBanner(
      {required this.color,
      required this.icon,
      required this.title,
      required this.body});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color, size: 22),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title,
                    style: TextStyle(
                        fontWeight: FontWeight.bold, color: color)),
                const SizedBox(height: 2),
                Text(body, style: const TextStyle(fontSize: 13)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ── Booking card ──────────────────────────────────────────────────────────────

class _BookingCard extends ConsumerWidget {
  final Booking booking;
  final VoidCallback onRefresh;
  const _BookingCard({required this.booking, required this.onRefresh});

  bool get _tripIsActive =>
      booking.trip?.status == 'active' || booking.trip?.status == 'ongoing';

  Color get _statusColor => switch (booking.status) {
        'pending_driver_approval' => Colors.blue,
        'pending' || 'pending_payment' => Colors.orange,
        'in_progress' => Colors.orange,
        'confirmed' when _tripIsActive => Colors.orange,
        'confirmed' => AppColors.primary,
        'completed' || 'trip_completed' => Colors.grey,
        'cancelled' || 'cancelled_by_passenger' || 'cancelled_by_driver' || 'refunded' => Colors.red,
        'disputed' => Colors.deepOrange,
        _ => Colors.grey,
      };

  String get _statusLabel => switch (booking.status) {
        'pending_driver_approval' => 'في انتظار موافقة السائق',
        'pending' || 'pending_payment' => 'قيد الانتظار',
        'in_progress' => 'الرحلة جارية',
        'confirmed' when _tripIsActive => 'الرحلة جارية',
        'confirmed' => 'مؤكد',
        'completed' || 'trip_completed' => 'مكتمل',
        'cancelled' || 'cancelled_by_passenger' || 'cancelled_by_driver' => 'ملغى',
        'refunded' => 'مسترد',
        'disputed' => 'نزاع',
        _ => booking.status,
      };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final trip = booking.trip;

    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => context.push('/trips/${booking.tripId}'),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      trip != null
                          ? '${trip.originCity} ← ${trip.destinationCity}'
                          : 'رحلة #${booking.tripId.substring(0, 8)}',
                      style: const TextStyle(
                          fontWeight: FontWeight.bold, fontSize: 15),
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 10, vertical: 3),
                    decoration: BoxDecoration(
                      color: _statusColor.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: _statusColor),
                    ),
                    child: Text(_statusLabel,
                        style:
                            TextStyle(color: _statusColor, fontSize: 12)),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  const Icon(Icons.event_seat_rounded,
                      size: 14, color: Colors.grey),
                  const SizedBox(width: 4),
                  Text('${booking.seatsCount} مقعد',
                      style: Theme.of(context).textTheme.bodySmall),
                  const SizedBox(width: 12),
                  const Icon(Icons.attach_money_rounded,
                      size: 14, color: Colors.grey),
                  Text('${booking.totalAmount.toStringAsFixed(0)} جنيه',
                      style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
              if (trip != null) TripBadgeRow.fromTrip(trip),
              if (booking.canCancel ||
                  booking.isActive ||
                  booking.canRate ||
                  booking.canDispute) ...[
                const SizedBox(height: 4),
                Wrap(
                  alignment: WrapAlignment.end,
                  spacing: 0,
                  runSpacing: 0,
                  children: [
                    if (booking.canCancel)
                      TextButton.icon(
                        icon: const Icon(Icons.cancel_outlined, size: 16),
                        label: const Text('إلغاء'),
                        style: TextButton.styleFrom(
                            foregroundColor: Colors.red),
                        onPressed: () async {
                          final didCancel =
                              await _showCancelDialog(context, ref, booking);
                          if (didCancel && context.mounted) onRefresh();
                        },
                      ),
                    if (booking.isActive)
                      TextButton.icon(
                        icon: const Icon(Icons.location_on_rounded, size: 16),
                        label: const Text('تتبع السائق'),
                        style: TextButton.styleFrom(
                            foregroundColor: AppColors.primary),
                        onPressed: () => context.push(
                          '/trips/${booking.tripId}/live',
                          extra: {'isDriver': false},
                        ),
                      ),
                    if (booking.canRate)
                      TextButton.icon(
                        icon: const Icon(Icons.star_outline_rounded, size: 16),
                        label: const Text('قيّم الرحلة'),
                        style: TextButton.styleFrom(
                            foregroundColor: AppColors.secondary),
                        onPressed: () =>
                            context.push('/bookings/rate', extra: booking),
                      ),
                    if (booking.canDispute)
                      TextButton.icon(
                        icon: const Icon(Icons.report_outlined, size: 16),
                        label: const Text('فتح نزاع'),
                        style: TextButton.styleFrom(
                            foregroundColor: Colors.deepOrange),
                        onPressed: () => context.push(
                          '/disputes/open?bookingId=${booking.id}',
                        ),
                      ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
