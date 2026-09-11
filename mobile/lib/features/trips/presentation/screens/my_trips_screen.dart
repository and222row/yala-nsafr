import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_endpoints.dart';
import '../../../../core/models/trip.dart';
import '../../../../core/theme/app_theme.dart';
import '../../providers/trips_provider.dart';
import '../../../../shared/widgets/skeletons.dart';
import '../../../../shared/widgets/trip_badge_row.dart';
import '../widgets/post_trip_guard.dart';

class MyTripsScreen extends ConsumerStatefulWidget {
  const MyTripsScreen({super.key});

  @override
  ConsumerState<MyTripsScreen> createState() => _MyTripsScreenState();
}

class _MyTripsScreenState extends ConsumerState<MyTripsScreen>
    with SingleTickerProviderStateMixin {
  static const _limit = 20;

  late final TabController _tabController;

  int _page = 1;
  List<Trip> _trips = [];
  int _total = 0;
  bool _loading = false;
  bool _initialLoad = true;
  String? _error;

  List<Trip> get _upcoming => _trips
      .where((t) => t.status == 'scheduled' || t.status == 'active' || t.status == 'ongoing')
      .toList();

  List<Trip> get _past => _trips
      .where((t) => t.status == 'completed' || t.status == 'cancelled')
      .toList();

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _load();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _load({bool reset = false}) async {
    if (reset) _page = 1;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await ref.read(dioProvider).get(
        Endpoints.myTrips,
        queryParameters: {'page': _page, 'limit': _limit},
      );
      final body = res.data;
      final list = body is Map
          ? (body['data'] as List? ?? [])
          : body as List;
      final total = body is Map
          ? (body['total'] as num?)?.toInt() ?? 0
          : list.length;
      final incoming =
          list.map((e) => Trip.fromJson(e as Map<String, dynamic>)).toList();
      setState(() {
        _trips = reset ? incoming : [..._trips, ...incoming];
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

  Future<void> _cancelTrip(Trip trip) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('إلغاء الرحلة'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.red.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: Colors.red.withValues(alpha: 0.4)),
              ),
              child: const Row(
                children: [
                  Icon(Icons.warning_amber_rounded, color: Colors.red),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'سيتم استرداد المبلغ كاملاً لجميع الركاب المحجوزين فوراً.',
                      style: TextStyle(fontSize: 13),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            const Text('هل أنت متأكد أنك تريد إلغاء هذه الرحلة؟'),
          ],
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('تراجع')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('إلغاء الرحلة'),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    try {
      await cancelTrip(ref, trip.id, reason: 'إلغاء من قِبل السائق');
      if (mounted) {
        _load(reset: true);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تم إلغاء الرحلة وإخطار الركاب')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  bool get _hasMore => _trips.length < _total;

  @override
  Widget build(BuildContext context) {
    ref.listen<int>(tripsRefreshTokenProvider, (prev, next) {
      if (prev != null && prev != next) _load(reset: true);
    });
    return Scaffold(
      appBar: AppBar(
        title: const Text('رحلاتي'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add_rounded),
            onPressed: () => guardedPostTrip(context, ref),
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: 'القادمة'),
            Tab(text: 'السابقة'),
          ],
        ),
      ),
      body: _initialLoad
          ? SkeletonCardList(itemBuilder: () => const ListCardSkeleton())
          : _error != null && _trips.isEmpty
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.error_outline_rounded,
                          size: 48, color: Colors.red),
                      const SizedBox(height: 8),
                      Text(_error!, textAlign: TextAlign.center),
                      const SizedBox(height: 16),
                      FilledButton(
                        onPressed: () => _load(reset: true),
                        child: const Text('إعادة المحاولة'),
                      ),
                    ],
                  ),
                )
              : TabBarView(
                  controller: _tabController,
                  children: [
                    _TripList(
                      trips: _upcoming,
                      hasMore: _hasMore,
                      loading: _loading,
                      onLoadMore: () {
                        setState(() => _page++);
                        _load();
                      },
                      onRefresh: () => _load(reset: true),
                      onCancel: _cancelTrip,
                      emptyIcon: Icons.directions_car_outlined,
                      emptyMessage: 'لا توجد رحلات قادمة',
                      emptySubMessage: 'انشر رحلتك وشارك التكلفة مع مسافرين على طريقك',
                      emptyAction: FilledButton.icon(
                        icon: const Icon(Icons.add_rounded),
                        label: const Text('انشر رحلتك الأولى'),
                        onPressed: () => guardedPostTrip(context, ref),
                      ),
                    ),
                    _TripList(
                      trips: _past,
                      hasMore: _hasMore,
                      loading: _loading,
                      onLoadMore: () {
                        setState(() => _page++);
                        _load();
                      },
                      onRefresh: () => _load(reset: true),
                      onCancel: _cancelTrip,
                      emptyIcon: Icons.history_rounded,
                      emptyMessage: 'لا توجد رحلات سابقة',
                      emptySubMessage: 'ستظهر هنا رحلاتك المكتملة والملغاة',
                    ),
                  ],
                ),
    );
  }
}

class _TripList extends StatelessWidget {
  final List<Trip> trips;
  final bool hasMore;
  final bool loading;
  final VoidCallback onLoadMore;
  final Future<void> Function() onRefresh;
  final void Function(Trip) onCancel;
  final IconData emptyIcon;
  final String emptyMessage;
  final String emptySubMessage;
  final Widget? emptyAction;

  const _TripList({
    required this.trips,
    required this.hasMore,
    required this.loading,
    required this.onLoadMore,
    required this.onRefresh,
    required this.onCancel,
    required this.emptyIcon,
    required this.emptyMessage,
    required this.emptySubMessage,
    this.emptyAction,
  });

  @override
  Widget build(BuildContext context) {
    if (trips.isEmpty && !loading) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 40),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(emptyIcon, size: 80, color: Colors.grey.shade300),
              const SizedBox(height: 16),
              Text(emptyMessage,
                  style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w600,
                      color: Colors.grey)),
              const SizedBox(height: 8),
              Text(emptySubMessage,
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 13, color: Colors.grey[400])),
              if (emptyAction != null) ...[
                const SizedBox(height: 24),
                emptyAction!,
              ],
            ],
          ),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: trips.length + (hasMore || loading ? 1 : 0),
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (_, i) {
          if (i == trips.length) {
            return loading
                ? const Center(
                    child: Padding(
                      padding: EdgeInsets.all(16),
                      child: CircularProgressIndicator(),
                    ),
                  )
                : Center(
                    child: TextButton(
                      onPressed: onLoadMore,
                      child: const Text('تحميل المزيد'),
                    ),
                  );
          }
          return _MyTripCard(
            trip: trips[i],
            onCancel: () => onCancel(trips[i]),
          );
        },
      ),
    );
  }
}

class _MyTripCard extends ConsumerWidget {
  final Trip trip;
  final VoidCallback onCancel;
  const _MyTripCard({required this.trip, required this.onCancel});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final statusColor = switch (trip.status) {
      'scheduled' => AppColors.primary,
      'active' || 'ongoing' => Colors.orange,
      'completed' => Colors.grey,
      'cancelled' => Colors.red,
      _ => Colors.grey,
    };
    final statusLabel = switch (trip.status) {
      'scheduled' => 'مجدولة',
      'active' || 'ongoing' => 'جارية',
      'completed' => 'مكتملة',
      'cancelled' => 'ملغاة',
      _ => trip.status,
    };

    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => context.push('/trips/${trip.id}'),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${trip.originCity} ← ${trip.destinationCity}',
                          style: const TextStyle(
                              fontWeight: FontWeight.bold, fontSize: 16),
                        ),
                        if (trip.originAddress != null ||
                            trip.destinationAddress != null)
                          Padding(
                            padding: const EdgeInsets.only(top: 2),
                            child: Text(
                              [
                                if (trip.originAddress != null)
                                  '📍 ${trip.originAddress}',
                                if (trip.destinationAddress != null)
                                  '🏁 ${trip.destinationAddress}',
                              ].join('  '),
                              style: TextStyle(
                                  fontSize: 11, color: Colors.grey[600]),
                            ),
                          ),
                      ],
                    ),
                  ),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                    decoration: BoxDecoration(
                      color: statusColor.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: statusColor),
                    ),
                    child: Text(statusLabel,
                        style: TextStyle(color: statusColor, fontSize: 12)),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  const Icon(Icons.access_time_rounded,
                      size: 14, color: Colors.grey),
                  const SizedBox(width: 4),
                  Text(_fmtDateTime(trip.departureTime),
                      style: Theme.of(context).textTheme.bodySmall),
                  const Spacer(),
                  const Icon(Icons.event_seat_rounded,
                      size: 14, color: Colors.grey),
                  const SizedBox(width: 4),
                  Text('${trip.availableSeats}/${trip.totalSeats} متاح',
                      style: Theme.of(context).textTheme.bodySmall),
                  const SizedBox(width: 12),
                  const Icon(Icons.attach_money_rounded,
                      size: 14, color: Colors.grey),
                  Text('${trip.pricePerSeat} جنيه',
                      style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
              if (trip.driver.vehicleLabel.isNotEmpty) ...[
                const SizedBox(height: 4),
                Row(
                  children: [
                    const Icon(Icons.directions_car_rounded,
                        size: 13, color: Colors.grey),
                    const SizedBox(width: 4),
                    Text(trip.driver.vehicleLabel,
                        style: Theme.of(context)
                            .textTheme
                            .bodySmall
                            ?.copyWith(color: Colors.grey[600])),
                  ],
                ),
              ],
              TripBadgeRow.fromTrip(trip),
              if (trip.status == 'scheduled' ||
                  trip.status == 'active' ||
                  trip.status == 'completed') ...[
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    if (trip.status == 'scheduled') ...[
                      TextButton.icon(
                        icon: const Icon(Icons.edit_outlined, size: 16),
                        label: const Text('تعديل'),
                        style: TextButton.styleFrom(
                            foregroundColor: AppColors.primary),
                        onPressed: () =>
                            context.push('/trips/${trip.id}/edit', extra: trip),
                      ),
                      TextButton.icon(
                        icon: const Icon(Icons.cancel_outlined, size: 16),
                        label: const Text('إلغاء'),
                        style:
                            TextButton.styleFrom(foregroundColor: Colors.red),
                        onPressed: onCancel,
                      ),
                    ],
                    if (trip.status == 'active')
                      TextButton.icon(
                        icon:
                            const Icon(Icons.location_on_rounded, size: 16),
                        label: const Text('مشاركة الموقع'),
                        style: TextButton.styleFrom(
                            foregroundColor: AppColors.primary),
                        onPressed: () => context.push(
                          '/trips/${trip.id}/live',
                          extra: {'isDriver': true},
                        ),
                      ),
                    if (trip.status == 'completed')
                      TextButton.icon(
                        icon:
                            const Icon(Icons.star_outline_rounded, size: 16),
                        label: const Text('قيّم الركاب'),
                        style: TextButton.styleFrom(
                            foregroundColor: AppColors.secondary),
                        onPressed: () =>
                            context.push('/trips/${trip.id}/passengers'),
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

  String _fmtDateTime(DateTime dt) =>
      '${dt.day}/${dt.month}/${dt.year} '
      '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
}
