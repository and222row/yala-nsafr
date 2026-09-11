import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/api/api_client.dart';
import '../widgets/admin_scaffold.dart';

class AdminTripsScreen extends ConsumerStatefulWidget {
  const AdminTripsScreen({super.key});

  @override
  ConsumerState<AdminTripsScreen> createState() => _AdminTripsScreenState();
}

class _AdminTripsScreenState extends ConsumerState<AdminTripsScreen> {
  String? _status;
  int _page = 1;
  static const _limit = 20;

  List<Map<String, dynamic>> _trips = [];
  int _total = 0;
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool reset = false}) async {
    if (reset) {
      _page = 1;
      _trips = [];
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final params = <String, dynamic>{
        'page': _page,
        'limit': _limit,
        if (_status != null) 'status': _status,
      };
      final resp = await ref.read(dioProvider).get('/admin/trips', queryParameters: params);
      final data = resp.data as Map<String, dynamic>;
      setState(() {
        _trips = [
          ..._trips,
          ...((data['data'] as List?)?.cast<Map<String, dynamic>>() ?? []),
        ];
        _total = (data['total'] as num?)?.toInt() ?? 0;
      });
    } catch (e) {
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Widget _chip(String label, bool selected, VoidCallback onTap) => Padding(
        padding: const EdgeInsets.only(left: 6),
        child: FilterChip(
          label: Text(label),
          selected: selected,
          onSelected: (_) => onTap(),
          visualDensity: VisualDensity.compact,
        ),
      );

  @override
  Widget build(BuildContext context) {
    final hasMore = _page * _limit < _total;

    return AdminScaffold(
      title: 'الرحلات${_total > 0 ? ' ($_total)' : ''}',
      body: Column(
        children: [
          SizedBox(
            height: 42,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              children: [
                _chip('الكل', _status == null, () {
                  setState(() => _status = null);
                  _load(reset: true);
                }),
                _chip('مجدولة', _status == 'scheduled', () {
                  setState(() => _status = _status == 'scheduled' ? null : 'scheduled');
                  _load(reset: true);
                }),
                _chip('جارية', _status == 'active', () {
                  setState(() => _status = _status == 'active' ? null : 'active');
                  _load(reset: true);
                }),
                _chip('مكتملة', _status == 'completed', () {
                  setState(() => _status = _status == 'completed' ? null : 'completed');
                  _load(reset: true);
                }),
                _chip('ملغاة', _status == 'cancelled', () {
                  setState(() => _status = _status == 'cancelled' ? null : 'cancelled');
                  _load(reset: true);
                }),
              ],
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(12),
              child: Text(_error!, style: const TextStyle(color: Colors.red)),
            ),
          Expanded(
            child: _loading && _trips.isEmpty
                ? const Center(child: CircularProgressIndicator())
                : RefreshIndicator(
                    onRefresh: () => _load(reset: true),
                    child: ListView.separated(
                      padding: const EdgeInsets.all(12),
                      itemCount: _trips.length + (hasMore || _loading ? 1 : 0),
                      separatorBuilder: (_, __) => const SizedBox(height: 6),
                      itemBuilder: (_, i) {
                        if (i == _trips.length) {
                          return _loading
                              ? const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator()))
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
                        return _TripCard(
                          trip: _trips[i],
                          onTap: () => context.push('/trips/${_trips[i]['id']}'),
                        );
                      },
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

class _TripCard extends StatelessWidget {
  final Map<String, dynamic> trip;
  final VoidCallback onTap;
  const _TripCard({required this.trip, required this.onTap});

  Color get _statusColor => switch (trip['status'] as String? ?? '') {
        'scheduled' => Colors.blue,
        'active' || 'ongoing' => Colors.orange,
        'completed' => Colors.green,
        'cancelled' => Colors.red,
        _ => Colors.grey,
      };

  String get _statusLabel => switch (trip['status'] as String? ?? '') {
        'scheduled' => 'مجدولة',
        'active' || 'ongoing' => 'جارية',
        'completed' => 'مكتملة',
        'cancelled' => 'ملغاة',
        _ => trip['status'] as String? ?? '',
      };

  String _fmtDate(String? raw) {
    if (raw == null) return '-';
    final dt = DateTime.tryParse(raw);
    if (dt == null) return raw;
    return '${dt.day}/${dt.month}/${dt.year} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final driver = trip['driver'] as Map<String, dynamic>? ?? {};
    return Card(
      child: ListTile(
        onTap: onTap,
        title: Text(
          '${trip['originCity'] ?? '-'} ← ${trip['destinationCity'] ?? '-'}',
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(driver['fullName'] as String? ?? '-',
                style: Theme.of(context).textTheme.bodySmall),
            Text(_fmtDate(trip['departureTime'] as String?),
                style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 2),
            Row(
              children: [
                Icon(Icons.event_seat_rounded, size: 13, color: Colors.grey[600]),
                const SizedBox(width: 3),
                Text(
                  '${trip['availableSeats'] ?? '-'}/${trip['totalSeats'] ?? '-'}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(width: 10),
                Icon(Icons.attach_money_rounded, size: 13, color: Colors.grey[600]),
                Text(
                  '${trip['pricePerSeat'] ?? '-'} ج',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ],
        ),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: _statusColor.withOpacity(0.1),
                border: Border.all(color: _statusColor),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                _statusLabel,
                style: TextStyle(
                    color: _statusColor,
                    fontSize: 11,
                    fontWeight: FontWeight.w600),
              ),
            ),
            const Icon(Icons.chevron_right_rounded),
          ],
        ),
        isThreeLine: true,
      ),
    );
  }
}
