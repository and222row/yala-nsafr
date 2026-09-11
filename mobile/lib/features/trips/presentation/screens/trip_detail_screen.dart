import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../core/services/analytics_service.dart';
import '../../../../shared/widgets/seat_urgency_label.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_endpoints.dart';
import '../../../../core/models/booking.dart';
import '../../../../core/models/trip.dart';
import '../../../../core/models/trip_comment.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../shared/widgets/app_button.dart';
import '../../../../shared/widgets/rating_stars.dart';
import '../../providers/trips_provider.dart';
import '../../../auth/providers/auth_provider.dart';
import '../../../bookings/providers/bookings_provider.dart';

class TripDetailScreen extends ConsumerStatefulWidget {
  final String tripId;
  const TripDetailScreen({super.key, required this.tripId});

  @override
  ConsumerState<TripDetailScreen> createState() => _TripDetailScreenState();
}

class _TripDetailScreenState extends ConsumerState<TripDetailScreen> {
  int _seats = 1;
  final _commentCtrl = TextEditingController();
  bool _postingComment = false;
  bool _startingTrip = false;
  bool _endingTrip = false;

  @override
  void dispose() {
    _commentCtrl.dispose();
    super.dispose();
  }

  String _bookingStatusLabel(String status) => switch (status) {
        'confirmed' => 'مؤكد',
        'trip_completed' => 'مكتملة',
        'pending_payment' => 'في انتظار الدفع',
        'disputed' => 'نزاع مفتوح',
        _ => status,
      };

  Future<void> _startTrip(String tripId) async {
    setState(() => _startingTrip = true);
    try {
      final dio = ref.read(dioProvider);
      await dio.patch('/trips/$tripId/start');
      ref.invalidate(tripDetailProvider(widget.tripId));
      ref.invalidate(myTripsProvider);
      if (mounted) {
        context.push('/trips/$tripId/live', extra: {'isDriver': true});
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('فشل بدء الرحلة: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _startingTrip = false);
    }
  }

  void _showAddSeatsSheet(BuildContext context, trip) {
    int extraSeats = 1;
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => Padding(
          padding: const EdgeInsets.fromLTRB(24, 20, 24, 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40, height: 4,
                decoration: BoxDecoration(
                    color: Colors.grey.shade300,
                    borderRadius: BorderRadius.circular(2)),
              ),
              const SizedBox(height: 16),
              Text('إضافة مقاعد أخرى',
                  style: Theme.of(ctx).textTheme.titleLarge
                      ?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 24),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  IconButton(
                    icon: const Icon(Icons.remove_circle_outline_rounded,
                        size: 32),
                    onPressed: extraSeats > 1
                        ? () => setModalState(() => extraSeats--)
                        : null,
                  ),
                  const SizedBox(width: 16),
                  Text('$extraSeats',
                      style: const TextStyle(
                          fontSize: 32, fontWeight: FontWeight.bold)),
                  const SizedBox(width: 16),
                  IconButton(
                    icon: const Icon(Icons.add_circle_outline_rounded,
                        size: 32),
                    onPressed: extraSeats < trip.availableSeats
                        ? () => setModalState(() => extraSeats++)
                        : null,
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                'الإجمالي: ${(trip.pricePerSeat * extraSeats).toStringAsFixed(0)} جنيه',
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () {
                    Navigator.pop(ctx);
                    context.push(
                      '/bookings/confirm',
                      extra: {'trip': trip, 'seats': extraSeats},
                    );
                  },
                  child: const Text('متابعة للدفع'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _endTrip(String tripId) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('إنهاء الرحلة'),
        content: const Text('هل أنت متأكد من إنهاء الرحلة؟'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('إلغاء')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('إنهاء')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _endingTrip = true);
    try {
      final dio = ref.read(dioProvider);
      await dio.patch('/trips/$tripId/complete');
      ref.invalidate(tripDetailProvider(widget.tripId));
      ref.invalidate(myTripsProvider);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تم إنهاء الرحلة بنجاح')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('فشل إنهاء الرحلة: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _endingTrip = false);
    }
  }

  Future<void> _postComment() async {
    final text = _commentCtrl.text.trim();
    if (text.isEmpty) return;
    setState(() => _postingComment = true);
    try {
      final dio = ref.read(dioProvider);
      await dio.post(Endpoints.tripComments(widget.tripId), data: {'body': text});
      _commentCtrl.clear();
      ref.invalidate(tripCommentsProvider(widget.tripId));
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('حدث خطأ أثناء إرسال التعليق')),
        );
      }
    } finally {
      if (mounted) setState(() => _postingComment = false);
    }
  }

  bool _viewLogged = false;

  Future<void> _shareTrip(Trip trip) async {
    AnalyticsService.logTripShared(tripId: trip.id).ignore();
    final dt = trip.departureTime;
    final date =
        '${dt.day}/${dt.month}/${dt.year}';
    final time =
        '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';

    final buf = StringBuffer()
      ..writeln('🚗 رحلة يلا نسافر')
      ..writeln()
      ..writeln('${trip.originCity} ← ${trip.destinationCity}')
      ..writeln('📅 $date - $time')
      ..writeln('💺 ${trip.availableSeats} مقعد متاح')
      ..writeln('💰 ${trip.pricePerSeat.toStringAsFixed(0)} جنيه/مقعد');

    final vehicle = trip.driver.vehicleLabel;
    if (vehicle.isNotEmpty) buf.writeln('🚙 $vehicle');

    buf
      ..writeln('👤 السائق: ${trip.driver.fullName}')
      ..writeln()
      ..writeln('احجز مقعدك الآن:')
      ..write('https://yalansafr.app/trips/${trip.id}');

    await Share.share(buf.toString());
  }

  @override
  Widget build(BuildContext context) {
    final tripAsync = ref.watch(tripDetailProvider(widget.tripId));
    final currentUserId = ref.watch(authProvider).user?.id;

    return Scaffold(
      appBar: AppBar(
        title: const Text('تفاصيل الرحلة'),
        actions: [
          tripAsync.maybeWhen(
            data: (trip) => IconButton(
              icon: const Icon(Icons.share_rounded),
              tooltip: 'مشاركة الرحلة',
              onPressed: () => _shareTrip(trip),
            ),
            orElse: () => const SizedBox.shrink(),
          ),
          if (currentUserId != null)
            tripAsync.maybeWhen(
              data: (trip) => IconButton(
                icon: const Icon(Icons.chat_bubble_outline_rounded),
                tooltip: 'مجموعة الرحلة',
                onPressed: () => context.push(
                  '/trips/${trip.id}/chat',
                  extra: {
                    'label': '${trip.originCity} ← ${trip.destinationCity}',
                  },
                ),
              ),
              orElse: () => const SizedBox.shrink(),
            ),
        ],
      ),
      body: tripAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('$e')),
        data: (trip) {
          if (!_viewLogged) {
            _viewLogged = true;
            AnalyticsService.logViewTrip(
              tripId: trip.id,
              origin: trip.originCity,
              destination: trip.destinationCity,
              price: trip.pricePerSeat,
            ).ignore();
          }
          final isDriver = currentUserId != null && currentUserId == trip.driverId;
          final myBookings = ref.watch(myBookingsProvider).valueOrNull ?? [];
          final existingBooking = myBookings.where((b) =>
            b.tripId == trip.id &&
            b.status != 'cancelled_by_passenger' &&
            b.status != 'cancelled_by_driver' &&
            b.status != 'refunded' &&
            b.status != 'trip_completed',
          ).firstOrNull;
          return Column(
            children: [
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _RouteHeader(trip: trip),
                      const SizedBox(height: 16),
                      _DriverCard(trip: trip),
                      const SizedBox(height: 16),
                      _CoPassengersSection(tripId: widget.tripId),
                      const SizedBox(height: 16),
                      _PreferencesCard(trip: trip),
                      if (trip.notes != null && trip.notes!.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        _NotesCard(notes: trip.notes!),
                      ],
                      const SizedBox(height: 24),
                      if (isDriver) ...[
                        _SeatsSummary(trip: trip),
                        const SizedBox(height: 16),
                        OutlinedButton.icon(
                          icon: const Icon(Icons.people_rounded),
                          label: const Text('عرض الركاب'),
                          onPressed: () =>
                              context.push('/trips/${trip.id}/passengers'),
                        ),
                        const SizedBox(height: 8),
                        if (trip.status == 'scheduled')
                          FilledButton.icon(
                            icon: _startingTrip
                                ? const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2, color: Colors.white),
                                  )
                                : const Icon(Icons.play_arrow_rounded),
                            label: const Text('بدء الرحلة'),
                            onPressed: _startingTrip
                                ? null
                                : () => _startTrip(trip.id),
                          )
                        else if (trip.status == 'active' ||
                            trip.status == 'ongoing') ...[
                          FilledButton.icon(
                            icon: const Icon(Icons.location_on_rounded),
                            label: const Text('مشاركة الموقع الحي'),
                            style: FilledButton.styleFrom(
                                backgroundColor: Colors.orange),
                            onPressed: () => context.push(
                              '/trips/${trip.id}/live',
                              extra: {'isDriver': true},
                            ),
                          ),
                          const SizedBox(height: 8),
                          OutlinedButton.icon(
                            icon: _endingTrip
                                ? const SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2),
                                  )
                                : const Icon(Icons.flag_rounded,
                                    color: Colors.red),
                            label: const Text('إنهاء الرحلة',
                                style: TextStyle(color: Colors.red)),
                            style: OutlinedButton.styleFrom(
                                side: const BorderSide(color: Colors.red)),
                            onPressed:
                                _endingTrip ? null : () => _endTrip(trip.id),
                          ),
                          const SizedBox(height: 8),
                          _SosButton(tripId: trip.id),
                        ],
                      ] else if (existingBooking != null) ...[
                        Container(
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: AppColors.primary.withOpacity(0.07),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(
                                color: AppColors.primary.withOpacity(0.3)),
                          ),
                          child: Row(
                            children: [
                              const Icon(Icons.check_circle_outline_rounded,
                                  color: AppColors.primary),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text('لديك حجز في هذه الرحلة',
                                        style: TextStyle(
                                            fontWeight: FontWeight.bold)),
                                    Text(
                                      _bookingStatusLabel(existingBooking.status),
                                      style: TextStyle(
                                          color: Colors.grey[600], fontSize: 13),
                                    ),
                                  ],
                                ),
                              ),
                              TextButton(
                                onPressed: () => context.push('/my-bookings'),
                                child: const Text('عرض حجوزاتي'),
                              ),
                            ],
                          ),
                        ),
                        if (trip.status == 'active' || trip.status == 'ongoing') ...[
                          const SizedBox(height: 10),
                          _SosButton(tripId: trip.id),
                        ],
                        if (trip.availableSeats > 0 &&
                            trip.status == 'scheduled' &&
                            (existingBooking.status == 'pending_driver_approval' ||
                             existingBooking.status == 'confirmed')) ...[
                          const SizedBox(height: 10),
                          SizedBox(
                            width: double.infinity,
                            child: OutlinedButton.icon(
                              icon: const Icon(Icons.add_circle_outline_rounded),
                              label: const Text('إضافة مقاعد أخرى'),
                              onPressed: () => _showAddSeatsSheet(context, trip),
                            ),
                          ),
                        ],
                      ] else if (trip.status != 'scheduled') ...[
                        // A completed booking is excluded from existingBooking above, so
                        // without this the seat picker reappears once the trip ends — and
                        // the backend rejects any booking on a non-scheduled trip.
                        _TripClosedNotice(status: trip.status),
                      ] else ...[
                        if (trip.availableSeats <= 4) ...[
                          SeatUrgencyLabel(availableSeats: trip.availableSeats),
                          const SizedBox(height: 8),
                        ],
                        Row(
                          children: [
                            const Text('عدد المقاعد',
                                style: TextStyle(fontSize: 16)),
                            const Spacer(),
                            IconButton(
                              icon: const Icon(
                                  Icons.remove_circle_outline_rounded),
                              onPressed: _seats > 1
                                  ? () => setState(() => _seats--)
                                  : null,
                            ),
                            Text('$_seats',
                                style: const TextStyle(
                                    fontSize: 20,
                                    fontWeight: FontWeight.bold)),
                            IconButton(
                              icon: const Icon(
                                  Icons.add_circle_outline_rounded),
                              onPressed: _seats < trip.availableSeats
                                  ? () => setState(() => _seats++)
                                  : null,
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text('الإجمالي'),
                            Text(
                              '${(trip.pricePerSeat * _seats).toStringAsFixed(0)} جنيه',
                              style: const TextStyle(
                                  fontSize: 22,
                                  fontWeight: FontWeight.bold,
                                  color: AppColors.primary),
                            ),
                          ],
                        ),
                        const SizedBox(height: 24),
                        AppButton(
                          label: 'احجز الآن',
                          onPressed: trip.availableSeats >= _seats
                              ? () {
                                  AnalyticsService.logBookingStart(
                                    tripId: trip.id,
                                    seats: _seats,
                                    pricePerSeat: trip.pricePerSeat,
                                  ).ignore();
                                  context.push(
                                    '/bookings/confirm',
                                    extra: {'trip': trip, 'seats': _seats},
                                  );
                                }
                              : null,
                        ),
                      ],
                      const SizedBox(height: 32),
                      const Divider(),
                      const SizedBox(height: 12),
                      _CommentsList(tripId: widget.tripId),
                      const SizedBox(height: 20),
                    ],
                  ),
                ),
              ),
              if (currentUserId != null)
                _CommentInputBar(
                  commentCtrl: _commentCtrl,
                  posting: _postingComment,
                  onPost: _postComment,
                ),
            ],
          );
        },
      ),
    );
  }
}

class _SeatsSummary extends StatelessWidget {
  final Trip trip;
  const _SeatsSummary({required this.trip});

  @override
  Widget build(BuildContext context) {
    final booked = trip.totalSeats - trip.availableSeats;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            _StatItem(label: 'إجمالي', value: '${trip.totalSeats}'),
            _StatItem(label: 'محجوز', value: '$booked', color: Colors.orange),
            _StatItem(label: 'متاح', value: '${trip.availableSeats}', color: AppColors.primary),
          ],
        ),
      ),
    );
  }
}

class _StatItem extends StatelessWidget {
  final String label;
  final String value;
  final Color? color;
  const _StatItem({required this.label, required this.value, this.color});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(value,
            style: TextStyle(
                fontSize: 26,
                fontWeight: FontWeight.bold,
                color: color ?? Colors.black87)),
        const SizedBox(height: 2),
        Text(label, style: Theme.of(context).textTheme.bodySmall),
      ],
    );
  }
}

class _CommentsList extends ConsumerWidget {
  final String tripId;
  const _CommentsList({required this.tripId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final commentsAsync = ref.watch(tripCommentsProvider(tripId));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('أسئلة وتعليقات',
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.bold)),
        const SizedBox(height: 12),
        commentsAsync.when(
          loading: () =>
              const Center(child: CircularProgressIndicator(strokeWidth: 2)),
          error: (_, __) => const SizedBox.shrink(),
          data: (comments) => comments.isEmpty
              ? Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Text('لا توجد تعليقات بعد. كن أول من يسأل!',
                      style: TextStyle(color: Colors.grey[600])),
                )
              : Column(
                  children:
                      comments.map((c) => _CommentTile(comment: c)).toList(),
                ),
        ),
      ],
    );
  }
}

class _CommentInputBar extends StatelessWidget {
  final TextEditingController commentCtrl;
  final bool posting;
  final VoidCallback onPost;

  const _CommentInputBar({
    required this.commentCtrl,
    required this.posting,
    required this.onPost,
  });

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surface,
          border: Border(
              top: BorderSide(color: Colors.grey.shade200, width: 1)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(
              child: TextField(
                controller: commentCtrl,
                decoration: const InputDecoration(
                  hintText: 'اسأل سؤالاً أو أضف تعليقاً...',
                  border: OutlineInputBorder(),
                  isDense: true,
                  contentPadding:
                      EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                ),
                maxLines: 4,
                minLines: 1,
              ),
            ),
            const SizedBox(width: 8),
            posting
                ? const SizedBox(
                    width: 44,
                    height: 44,
                    child: Padding(
                      padding: EdgeInsets.all(10),
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                : IconButton.filled(
                    icon: const Icon(Icons.send_rounded),
                    onPressed: onPost,
                  ),
          ],
        ),
      ),
    );
  }
}

class _CommentTile extends StatelessWidget {
  final TripComment comment;
  const _CommentTile({required this.comment});

  @override
  Widget build(BuildContext context) {
    final name = comment.displayName;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
            radius: 17,
            backgroundColor: AppColors.primary.withOpacity(0.1),
            child: Text(
              name.isNotEmpty ? name[0] : '?',
              style: const TextStyle(fontSize: 13, color: AppColors.primary),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name,
                    style: const TextStyle(
                        fontWeight: FontWeight.bold, fontSize: 13)),
                const SizedBox(height: 3),
                Text(comment.body, style: const TextStyle(fontSize: 14)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _NotesCard extends StatelessWidget {
  final String notes;
  const _NotesCard({required this.notes});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.info_outline_rounded,
                color: AppColors.primary, size: 20),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('ملاحظات من السائق',
                      style: Theme.of(context)
                          .textTheme
                          .labelMedium
                          ?.copyWith(color: Colors.grey[600])),
                  const SizedBox(height: 4),
                  Text(notes, style: const TextStyle(fontSize: 14)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RouteHeader extends StatelessWidget {
  final Trip trip;
  const _RouteHeader({required this.trip});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Expanded(
              child: Column(
                children: [
                  Text(trip.originCity,
                      style: const TextStyle(
                          fontSize: 20, fontWeight: FontWeight.bold)),
                  if (trip.originAddress != null) ...[
                    const SizedBox(height: 2),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.location_on_rounded,
                            size: 12, color: Colors.grey[500]),
                        const SizedBox(width: 2),
                        Flexible(
                          child: Text(
                            trip.originAddress!,
                            style: TextStyle(
                                fontSize: 12, color: Colors.grey[600]),
                            textAlign: TextAlign.center,
                          ),
                        ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 4),
                  Text(_fmtTime(trip.departureTime),
                      style: TextStyle(color: Colors.grey[600])),
                ],
              ),
            ),
            const Icon(Icons.arrow_back_rounded, color: AppColors.primary),
            Expanded(
              child: Column(
                children: [
                  Text(trip.destinationCity,
                      style: const TextStyle(
                          fontSize: 20, fontWeight: FontWeight.bold)),
                  if (trip.destinationAddress != null) ...[
                    const SizedBox(height: 2),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.location_on_rounded,
                            size: 12, color: Colors.grey[500]),
                        const SizedBox(width: 2),
                        Flexible(
                          child: Text(
                            trip.destinationAddress!,
                            style: TextStyle(
                                fontSize: 12, color: Colors.grey[600]),
                            textAlign: TextAlign.center,
                          ),
                        ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 4),
                  if (trip.estimatedArrivalTime != null)
                    Text(_fmtTime(trip.estimatedArrivalTime!),
                        style: TextStyle(color: Colors.grey[600])),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _fmtTime(DateTime dt) =>
      '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
}

class _DriverCard extends StatelessWidget {
  final Trip trip;
  const _DriverCard({required this.trip});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => context.push('/users/${trip.driverId}'),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              CircleAvatar(
                radius: 28,
                child: Text(
                  trip.driver.fullName.isNotEmpty
                      ? trip.driver.fullName[0]
                      : '?',
                  style: const TextStyle(fontSize: 22),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(trip.driver.fullName,
                        style: const TextStyle(
                            fontWeight: FontWeight.bold, fontSize: 16)),
                    RatingStars(
                        rating: trip.driver.ratingAverage,
                        count: trip.driver.ratingCount),
                    const SizedBox(height: 4),
                    Text(trip.driver.vehicleLabel,
                        style: Theme.of(context).textTheme.bodySmall),
                    const SizedBox(height: 2),
                    Text('اضغط لعرض الملف الشخصي',
                        style: TextStyle(
                            fontSize: 11, color: Colors.grey[500])),
                  ],
                ),
              ),
              const Icon(Icons.chevron_left_rounded, color: Colors.grey),
            ],
          ),
        ),
      ),
    );
  }
}

class _PreferencesCard extends StatelessWidget {
  final Trip trip;
  const _PreferencesCard({required this.trip});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('التفضيلات', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (trip.womenOnly)
                  _prefChip(
                      icon: Icons.female_rounded,
                      label: 'نساء فقط',
                      allowed: true),
                _prefChip(
                    icon: Icons.smoke_free_rounded,
                    label:
                        trip.smokingAllowed ? 'التدخين مسموح' : 'لا تدخين',
                    allowed: trip.smokingAllowed),
                _prefChip(
                    icon: Icons.pets_rounded,
                    label:
                        trip.petsAllowed ? 'حيوانات أليفة' : 'لا حيوانات',
                    allowed: trip.petsAllowed),
                _prefChip(
                    icon: Icons.luggage_rounded,
                    label: trip.luggageSize != 'none'
                        ? 'حقائب مسموح'
                        : 'بدون حقائب',
                    allowed: trip.luggageSize != 'none'),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _prefChip(
      {required IconData icon,
      required String label,
      required bool allowed}) {
    return Chip(
      avatar: Icon(icon, size: 16, color: allowed ? AppColors.primary : Colors.grey),
      label: Text(label, style: const TextStyle(fontSize: 12)),
    );
  }
}

// ── Co-passengers section ─────────────────────────────────────────────────────

class _CoPassengersSection extends ConsumerWidget {
  final String tripId;
  const _CoPassengersSection({required this.tripId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(coPassengersProvider(tripId));

    // Silently hide on error (403 = not a participant, no need to show anything)
    return async.when(
      loading: () => const SizedBox.shrink(),
      error: (_, __) => const SizedBox.shrink(),
      data: (passengers) {
        if (passengers.isEmpty) return const SizedBox.shrink();
        return Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(Icons.people_rounded,
                        size: 18, color: AppColors.primary),
                    const SizedBox(width: 8),
                    Text(
                      'رفقاء الرحلة (${passengers.length})',
                      style: Theme.of(context)
                          .textTheme
                          .titleSmall
                          ?.copyWith(fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                if (passengers.length <= 4)
                  Row(
                    children: passengers
                        .map((p) => _PassengerChip(p: p))
                        .toList(),
                  )
                else
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: passengers
                        .map((p) => _PassengerChip(p: p))
                        .toList(),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _SosButton extends ConsumerStatefulWidget {
  final String tripId;
  const _SosButton({required this.tripId});

  @override
  ConsumerState<_SosButton> createState() => _SosButtonState();
}

class _SosButtonState extends ConsumerState<_SosButton> {
  bool _loading = false;

  Future<void> _triggerSos() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('تأكيد SOS'),
        content: const Text(
          'سيتم الاتصال بالطوارئ (123) وإرسال تنبيه للسائق والإدارة فوراً.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('SOS'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _loading = true);
    try {
      // 1. Dial emergency services immediately
      await launchUrl(Uri.parse('tel:123'));

      // 2. Notify driver and admin via backend (best-effort)
      final dio = ref.read(dioProvider);
      await dio.post('/trips/${widget.tripId}/sos');

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('تم إرسال تنبيه الطوارئ. فريق الدعم في طريقه.'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } catch (_) {
      // SOS call still happened — swallow backend errors silently
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton.icon(
        icon: _loading
            ? const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(
                    strokeWidth: 2, color: Colors.white),
              )
            : const Icon(Icons.sos_rounded),
        label: const Text('SOS — طوارئ'),
        style: ElevatedButton.styleFrom(
          backgroundColor: Colors.red,
          foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(vertical: 14),
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12)),
        ),
        onPressed: _loading ? null : _triggerSos,
      ),
    );
  }
}

class _PassengerChip extends StatelessWidget {
  final Map<String, dynamic> p;
  const _PassengerChip({required this.p});

  @override
  Widget build(BuildContext context) {
    final firstName = p['firstName'] as String? ?? 'راكب';
    final rating = double.tryParse(p['ratingAverage']?.toString() ?? '') ?? 0.0;
    final ratingCount = (p['ratingCount'] as num?)?.toInt() ?? 0;
    final gender = p['gender'] as String?;
    final seatsCount = (p['seatsCount'] as num?)?.toInt() ?? 1;
    final isFemale = gender == 'female';

    return GestureDetector(
      onTap: () {
        final id = p['id'] as String?;
        if (id != null && id.isNotEmpty) {
          context.push('/users/$id');
        }
      },
      child: Container(
        width: 72,
        margin: const EdgeInsets.only(left: 8),
        child: Column(
          children: [
            Stack(
              children: [
                CircleAvatar(
                  radius: 26,
                  backgroundColor: AppColors.primary.withOpacity(0.1),
                  child: Text(
                    firstName.isNotEmpty ? firstName[0] : '؟',
                    style: const TextStyle(
                      fontSize: 20,
                      color: AppColors.primary,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                if (isFemale)
                  Positioned(
                    bottom: 0,
                    right: 0,
                    child: Container(
                      width: 16,
                      height: 16,
                      decoration: const BoxDecoration(
                        color: AppColors.womenOnly,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.female_rounded,
                          color: Colors.white, size: 11),
                    ),
                  ),
                if (seatsCount > 1)
                  Positioned(
                    top: 0,
                    left: 0,
                    child: Container(
                      width: 17,
                      height: 17,
                      decoration: BoxDecoration(
                        color: Colors.grey.shade600,
                        shape: BoxShape.circle,
                      ),
                      child: Center(
                        child: Text(
                          '$seatsCount',
                          style: const TextStyle(
                              color: Colors.white,
                              fontSize: 10,
                              fontWeight: FontWeight.bold),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 5),
            Text(
              firstName,
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
            ),
            if (ratingCount > 0)
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.star_rounded,
                      size: 11, color: Colors.amber),
                  Text(
                    rating.toStringAsFixed(1),
                    style: TextStyle(
                        fontSize: 10, color: Colors.grey[600]),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}


/// Shown instead of the seat picker once a trip is no longer bookable, so a passenger
/// is told why rather than being handed a button the backend will reject.
class _TripClosedNotice extends StatelessWidget {
  final String status;
  const _TripClosedNotice({required this.status});

  @override
  Widget build(BuildContext context) {
    final (icon, message, color) = switch (status) {
      'active' || 'ongoing' => (
          Icons.directions_car_filled_rounded,
          'الرحلة جارية بالفعل — لم يعد الحجز متاحاً',
          Colors.orange,
        ),
      'completed' => (
          Icons.check_circle_outline_rounded,
          'انتهت هذه الرحلة',
          Colors.grey,
        ),
      'cancelled' => (
          Icons.cancel_outlined,
          'تم إلغاء هذه الرحلة',
          Colors.red,
        ),
      _ => (
          Icons.info_outline_rounded,
          'الحجز غير متاح على هذه الرحلة',
          Colors.grey,
        ),
    };

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Row(
        children: [
          Icon(icon, color: color),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}
