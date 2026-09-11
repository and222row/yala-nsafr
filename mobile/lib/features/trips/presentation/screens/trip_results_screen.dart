import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/models/trip.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../shared/widgets/rating_stars.dart';
import '../../../../shared/widgets/skeletons.dart';
import '../../../../shared/widgets/trip_badge_row.dart';
import '../../providers/trips_provider.dart';
import '../widgets/post_trip_guard.dart';
import '../../../../core/services/analytics_service.dart';
import '../../../../shared/widgets/seat_urgency_label.dart';

// ── Sort / Filter state ───────────────────────────────────────────────────────

enum _SortBy { recommended, priceAsc, timeAsc, ratingDesc }

const _sentinel = Object();

class _TripFilters {
  final double? maxPrice;
  final Set<String> periods; // morning, afternoon, evening, night
  final bool womenOnly;
  final bool verifiedOnly;

  const _TripFilters({
    this.maxPrice,
    this.periods = const {},
    this.womenOnly = false,
    this.verifiedOnly = false,
  });

  bool get hasActive =>
      maxPrice != null || periods.isNotEmpty || womenOnly || verifiedOnly;

  int get activeCount =>
      (maxPrice != null ? 1 : 0) +
      (periods.isNotEmpty ? 1 : 0) +
      (womenOnly ? 1 : 0) +
      (verifiedOnly ? 1 : 0);

  _TripFilters copyWith({
    Object? maxPrice = _sentinel,
    Set<String>? periods,
    bool? womenOnly,
    bool? verifiedOnly,
  }) =>
      _TripFilters(
        maxPrice: maxPrice == _sentinel ? this.maxPrice : maxPrice as double?,
        periods: periods ?? this.periods,
        womenOnly: womenOnly ?? this.womenOnly,
        verifiedOnly: verifiedOnly ?? this.verifiedOnly,
      );
}

// ── Screen ────────────────────────────────────────────────────────────────────

class TripResultsScreen extends ConsumerStatefulWidget {
  final TripSearchParams params;
  const TripResultsScreen({super.key, required this.params});

  @override
  ConsumerState<TripResultsScreen> createState() => _TripResultsScreenState();
}

class _TripResultsScreenState extends ConsumerState<TripResultsScreen> {
  _SortBy _sortBy = _SortBy.recommended;
  _TripFilters _filters = const _TripFilters();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(tripSearchProvider.notifier).search(widget.params);
      AnalyticsService.logSearch(
        origin: widget.params.from,
        destination: widget.params.to,
        date: widget.params.date,
        seats: widget.params.seats,
      );
    });
  }

  static String _period(Trip t) {
    final h = t.departureTime.hour;
    if (h >= 5 && h < 12) return 'morning';
    if (h >= 12 && h < 17) return 'afternoon';
    if (h >= 17 && h < 21) return 'evening';
    return 'night';
  }

  List<Trip> _apply(List<Trip> trips) {
    var result = trips.where((t) {
      if (_filters.maxPrice != null && t.pricePerSeat > _filters.maxPrice!) {
        return false;
      }
      if (_filters.periods.isNotEmpty &&
          !_filters.periods.contains(_period(t))) {
        return false;
      }
      if (_filters.womenOnly && !t.womenOnly) return false;
      if (_filters.verifiedOnly && !t.driver.driverVerified) return false;
      return true;
    }).toList();

    switch (_sortBy) {
      case _SortBy.priceAsc:
        result.sort((a, b) => a.pricePerSeat.compareTo(b.pricePerSeat));
      case _SortBy.timeAsc:
        result.sort((a, b) => a.departureTime.compareTo(b.departureTime));
      case _SortBy.ratingDesc:
        result.sort((a, b) =>
            b.driver.ratingAverage.compareTo(a.driver.ratingAverage));
      case _SortBy.recommended:
        break;
    }
    return result;
  }

  Future<void> _showFilters(List<Trip> allTrips) async {
    final maxAvailable = allTrips.isEmpty
        ? 1000.0
        : allTrips.map((t) => t.pricePerSeat).reduce((a, b) => a > b ? a : b);

    final result = await showModalBottomSheet<_TripFilters>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => _FilterSheet(
        current: _filters,
        maxAvailable: maxAvailable,
        womenOnlySearch: widget.params.womenOnly,
      ),
    );
    if (result != null) setState(() => _filters = result);
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(tripSearchProvider);
    final p = widget.params;

    return Scaffold(
      appBar: AppBar(
        title: Text('${p.from} ← ${p.to}'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(20),
          child: Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Text(
              '${p.seats} مقعد · ${_fmtDate(p.date)}',
              style: const TextStyle(color: Colors.white70, fontSize: 12),
            ),
          ),
        ),
      ),
      body: state.when(
        loading: () =>
            SkeletonCardList(itemBuilder: () => const TripResultSkeleton()),
        error: (e, _) =>
            Center(child: Text('$e', style: const TextStyle(color: Colors.red))),
        data: (trips) {
          if (trips.isEmpty) {
            return _EmptySearch(
              params: widget.params,
              onChangeDate: () => context.pop(),
              onPostTrip: () => guardedPostTrip(context, ref),
            );
          }

          final displayed = _apply(trips);

          return Column(
            children: [
              _SortFilterBar(
                sortBy: _sortBy,
                filterCount: _filters.activeCount,
                onSort: (s) => setState(() => _sortBy = s),
                onFilterTap: () => _showFilters(trips),
              ),
              const Divider(height: 1),
              Expanded(
                child: displayed.isEmpty
                    ? _EmptyFiltered(
                        hasFilters: _filters.hasActive,
                        onClear: () =>
                            setState(() => _filters = const _TripFilters()),
                      )
                    : RefreshIndicator(
                        onRefresh: () => ref
                            .read(tripSearchProvider.notifier)
                            .search(widget.params),
                        child: ListView.separated(
                          padding: const EdgeInsets.all(16),
                          itemCount: displayed.length,
                          separatorBuilder: (_, __) =>
                              const SizedBox(height: 8),
                          itemBuilder: (_, i) =>
                              _TripCard(trip: displayed[i], seats: p.seats),
                        ),
                      ),
              ),
            ],
          );
        },
      ),
    );
  }

  String _fmtDate(DateTime d) => '${d.day}/${d.month}/${d.year}';
}

// ── Sort + Filter bar ─────────────────────────────────────────────────────────

class _SortFilterBar extends StatelessWidget {
  final _SortBy sortBy;
  final int filterCount;
  final ValueChanged<_SortBy> onSort;
  final VoidCallback onFilterTap;

  const _SortFilterBar({
    required this.sortBy,
    required this.filterCount,
    required this.onSort,
    required this.onFilterTap,
  });

  @override
  Widget build(BuildContext context) {
    const sorts = [
      (_SortBy.recommended, 'الأفضل'),
      (_SortBy.priceAsc, 'الأرخص'),
      (_SortBy.timeAsc, 'الأقرب وقتاً'),
      (_SortBy.ratingDesc, 'الأعلى تقييماً'),
    ];

    return SizedBox(
      height: 52,
      child: Row(
        children: [
          Expanded(
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              itemCount: sorts.length,
              separatorBuilder: (_, __) => const SizedBox(width: 6),
              itemBuilder: (_, i) {
                final s = sorts[i];
                final selected = sortBy == s.$1;
                return ChoiceChip(
                  label: Text(s.$2, style: const TextStyle(fontSize: 12)),
                  selected: selected,
                  onSelected: (_) => onSort(s.$1),
                  selectedColor: AppColors.primary,
                  labelStyle: TextStyle(
                    color: selected ? Colors.white : null,
                    fontSize: 12,
                  ),
                );
              },
            ),
          ),
          const VerticalDivider(width: 1, indent: 8, endIndent: 8),
          Stack(
            alignment: Alignment.center,
            children: [
              IconButton(
                icon: const Icon(Icons.tune_rounded),
                tooltip: 'فلترة',
                onPressed: onFilterTap,
              ),
              if (filterCount > 0)
                Positioned(
                  top: 6,
                  right: 6,
                  child: Container(
                    width: 16,
                    height: 16,
                    decoration: const BoxDecoration(
                      color: Colors.orange,
                      shape: BoxShape.circle,
                    ),
                    child: Center(
                      child: Text(
                        '$filterCount',
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
          const SizedBox(width: 4),
        ],
      ),
    );
  }
}

// ── Empty search state (API returned zero trips) ───────────────────────────────

class _EmptySearch extends StatelessWidget {
  final TripSearchParams params;
  final VoidCallback onChangeDate;
  final VoidCallback onPostTrip;

  const _EmptySearch({
    required this.params,
    required this.onChangeDate,
    required this.onPostTrip,
  });

  String get _dateLabel =>
      '${params.date.day}/${params.date.month}/${params.date.year}';

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 96,
              height: 96,
              decoration: BoxDecoration(
                color: AppColors.primary.withOpacity(0.08),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.directions_car_outlined,
                size: 48,
                color: AppColors.primary,
              ),
            ),
            const SizedBox(height: 24),
            Text(
              '${params.from} ← ${params.to}',
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 6),
            Text(
              _dateLabel,
              style: TextStyle(color: Colors.grey.shade500, fontSize: 14),
            ),
            const SizedBox(height: 14),
            Text(
              'لا توجد رحلات متاحة لهذا المسار في هذا اليوم',
              style: TextStyle(color: Colors.grey.shade600, fontSize: 14),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 32),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                icon: const Icon(Icons.add_road_rounded),
                label: const Text('انشر رحلتك وشارك التكلفة'),
                onPressed: onPostTrip,
              ),
            ),
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                icon: const Icon(Icons.calendar_month_rounded),
                label: const Text('ابحث في يوم آخر'),
                onPressed: onChangeDate,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Empty filtered state ──────────────────────────────────────────────────────

class _EmptyFiltered extends StatelessWidget {
  final bool hasFilters;
  final VoidCallback onClear;
  const _EmptyFiltered({required this.hasFilters, required this.onClear});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.search_off_rounded, size: 56, color: Colors.grey),
          const SizedBox(height: 12),
          Text(
            hasFilters
                ? 'لا توجد رحلات بهذه الفلاتر'
                : 'لا توجد رحلات متاحة لهذا اليوم',
            style: const TextStyle(color: Colors.grey, fontSize: 15),
          ),
          if (hasFilters) ...[
            const SizedBox(height: 12),
            TextButton.icon(
              icon: const Icon(Icons.filter_alt_off_rounded),
              label: const Text('مسح الفلاتر'),
              onPressed: onClear,
            ),
          ],
        ],
      ),
    );
  }
}

// ── Filter bottom sheet ───────────────────────────────────────────────────────

class _FilterSheet extends StatefulWidget {
  final _TripFilters current;
  final double maxAvailable;
  final bool womenOnlySearch;

  const _FilterSheet({
    required this.current,
    required this.maxAvailable,
    required this.womenOnlySearch,
  });

  @override
  State<_FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends State<_FilterSheet> {
  late double _maxPrice;
  late Set<String> _periods;
  late bool _womenOnly;
  late bool _verifiedOnly;

  @override
  void initState() {
    super.initState();
    _maxPrice = widget.current.maxPrice ?? widget.maxAvailable;
    _periods = Set.from(widget.current.periods);
    _womenOnly = widget.current.womenOnly;
    _verifiedOnly = widget.current.verifiedOnly;
  }

  _TripFilters get _result => _TripFilters(
        maxPrice: _maxPrice < widget.maxAvailable ? _maxPrice : null,
        periods: Set.unmodifiable(_periods),
        womenOnly: _womenOnly,
        verifiedOnly: _verifiedOnly,
      );

  void _reset() => setState(() {
        _maxPrice = widget.maxAvailable;
        _periods = {};
        _womenOnly = false;
        _verifiedOnly = false;
      });

  @override
  Widget build(BuildContext context) {
    const periodEntries = [
      ('morning', 'صباحاً', Icons.wb_sunny_outlined),
      ('afternoon', 'ظهراً', Icons.wb_cloudy_outlined),
      ('evening', 'مساءً', Icons.nights_stay_outlined),
      ('night', 'ليلاً', Icons.bedtime_outlined),
    ];

    final divisions =
        (widget.maxAvailable / 50).ceil().clamp(2, 200);

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Handle
        Container(
          margin: const EdgeInsets.symmetric(vertical: 10),
          width: 40,
          height: 4,
          decoration: BoxDecoration(
            color: Colors.grey[300],
            borderRadius: BorderRadius.circular(2),
          ),
        ),
        // Header
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 8, 0),
          child: Row(
            children: [
              const Text('فلترة النتائج',
                  style:
                      TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              const Spacer(),
              TextButton(
                  onPressed: _reset, child: const Text('مسح الكل')),
            ],
          ),
        ),
        const Divider(height: 1),
        Flexible(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // ── Price ─────────────────────────────────────────────────
                Row(
                  children: [
                    const Text('الحد الأقصى للسعر',
                        style: TextStyle(fontWeight: FontWeight.w600)),
                    const Spacer(),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 3),
                      decoration: BoxDecoration(
                        color: AppColors.primary.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        '${_maxPrice.toInt()} جنيه',
                        style: const TextStyle(
                            color: AppColors.primary,
                            fontWeight: FontWeight.bold,
                            fontSize: 13),
                      ),
                    ),
                  ],
                ),
                Slider(
                  value: _maxPrice.clamp(0.0, widget.maxAvailable),
                  min: 0,
                  max: widget.maxAvailable > 0 ? widget.maxAvailable : 1,
                  divisions: divisions,
                  activeColor: AppColors.primary,
                  onChanged: (v) => setState(() => _maxPrice = v),
                ),
                const SizedBox(height: 8),

                // ── Departure period ───────────────────────────────────────
                const Text('وقت الانطلاق',
                    style: TextStyle(fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 4,
                  children: periodEntries.map((e) {
                    final selected = _periods.contains(e.$1);
                    return FilterChip(
                      avatar: Icon(e.$3,
                          size: 16,
                          color: selected ? AppColors.primary : null),
                      label: Text(e.$2),
                      selected: selected,
                      selectedColor: AppColors.primary.withOpacity(0.12),
                      checkmarkColor: AppColors.primary,
                      onSelected: (v) => setState(() {
                        if (v) {
                          _periods = {..._periods, e.$1};
                        } else {
                          _periods =
                              _periods.where((p) => p != e.$1).toSet();
                        }
                      }),
                    );
                  }).toList(),
                ),
                const SizedBox(height: 8),

                // ── Toggles ────────────────────────────────────────────────
                if (!widget.womenOnlySearch)
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('نساء فقط'),
                    secondary: Icon(Icons.female_rounded,
                        color: _womenOnly
                            ? AppColors.womenOnly
                            : Colors.grey),
                    value: _womenOnly,
                    activeColor: AppColors.womenOnly,
                    onChanged: (v) => setState(() => _womenOnly = v),
                  ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('سائق موثّق فقط'),
                  subtitle: const Text('تحقق من الهوية والسيارة',
                      style: TextStyle(fontSize: 12)),
                  secondary: Icon(Icons.verified_rounded,
                      color: _verifiedOnly
                          ? AppColors.primary
                          : Colors.grey),
                  value: _verifiedOnly,
                  activeColor: AppColors.primary,
                  onChanged: (v) => setState(() => _verifiedOnly = v),
                ),
                const SizedBox(height: 8),
              ],
            ),
          ),
        ),
        const Divider(height: 1),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: FilledButton(
              style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(48)),
              onPressed: () => Navigator.pop(context, _result),
              child: const Text('تطبيق الفلاتر'),
            ),
          ),
        ),
      ],
    );
  }
}

// ── Trip card ─────────────────────────────────────────────────────────────────

class _TripCard extends StatelessWidget {
  final Trip trip;
  final int seats;
  const _TripCard({required this.trip, required this.seats});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () {
          AnalyticsService.logViewTrip(
            tripId: trip.id,
            origin: trip.originCity,
            destination: trip.destinationCity,
            price: trip.pricePerSeat,
          );
          context.push('/trips/${trip.id}', extra: trip);
        },
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CircleAvatar(
                    radius: 22,
                    child: Text(
                      trip.driver.fullName.isNotEmpty
                          ? trip.driver.fullName[0]
                          : '?',
                      style: const TextStyle(fontSize: 18),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(trip.driver.fullName,
                                  style: const TextStyle(
                                      fontWeight: FontWeight.bold)),
                            ),
                          ],
                        ),
                        RatingStars(
                            rating: trip.driver.ratingAverage,
                            count: trip.driver.ratingCount),
                      ],
                    ),
                  ),
                ],
              ),
              const Divider(height: 20),
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (trip.driver.vehicleLabel.isNotEmpty)
                          Text(trip.driver.vehicleLabel,
                              style: Theme.of(context).textTheme.bodySmall),
                        if (trip.originAddress != null)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 4),
                            child: Row(
                              children: [
                                Icon(Icons.location_on_rounded,
                                    size: 13, color: Colors.grey[500]),
                                const SizedBox(width: 3),
                                Text(
                                  'التحميل: ${trip.originAddress}',
                                  style: TextStyle(
                                      fontSize: 11, color: Colors.grey[600]),
                                ),
                              ],
                            ),
                          ),
                        SeatUrgencyLabel(availableSeats: trip.availableSeats),
                        TripBadgeRow.fromTrip(trip),
                      ],
                    ),
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        '${trip.pricePerSeat.toStringAsFixed(0)} جنيه',
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                            color: AppColors.primary,
                            fontWeight: FontWeight.bold),
                      ),
                      Text(
                        'للمقعد الواحد',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

