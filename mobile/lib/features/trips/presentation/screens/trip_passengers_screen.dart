import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_endpoints.dart';
import '../../../../core/models/booking.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../shared/widgets/rating_stars.dart';
import '../../providers/trips_provider.dart';

class TripPassengersScreen extends ConsumerWidget {
  final String tripId;
  const TripPassengersScreen({super.key, required this.tripId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bookingsAsync = ref.watch(tripBookingsProvider(tripId));

    return Scaffold(
      appBar: AppBar(title: const Text('ركاب الرحلة')),
      body: bookingsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('$e')),
        data: (raw) {
          final allBookings = raw
              .map((e) => Booking.fromJson(e as Map<String, dynamic>))
              .toList();

          // Deduplicate: one card per passenger, picking the most actionable
          // booking (pending_driver_approval > trip_completed > confirmed > other)
          const _priority = ['pending_driver_approval', 'trip_completed', 'confirmed'];
          final seen = <String, Booking>{};
          for (final b in allBookings) {
            final existing = seen[b.passengerId];
            if (existing == null) {
              seen[b.passengerId] = b;
            } else {
              final ei = _priority.indexOf(existing.status);
              final bi = _priority.indexOf(b.status);
              if (bi != -1 && (ei == -1 || bi < ei)) seen[b.passengerId] = b;
            }
          }
          final bookings = seen.values.toList();

          if (bookings.isEmpty) {
            return const Center(
              child: Text('لا يوجد ركاب لهذه الرحلة',
                  style: TextStyle(color: Colors.grey, fontSize: 16)),
            );
          }

          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: bookings.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (_, i) => _PassengerCard(booking: bookings[i]),
          );
        },
      ),
    );
  }
}

class _PassengerCard extends ConsumerWidget {
  final Booking booking;
  const _PassengerCard({required this.booking});

  Future<void> _approveBooking(BuildContext context, WidgetRef ref, Booking booking) async {
    try {
      await ref.read(dioProvider).patch(Endpoints.bookingApprove(booking.id));
      ref.invalidate(tripBookingsProvider(booking.tripId));
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تمت الموافقة على الحجز ✅')),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  Future<void> _rejectBooking(BuildContext context, WidgetRef ref, Booking booking) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('رفض الحجز'),
        content: const Text('هل تريد رفض طلب الحجز هذا؟'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('تراجع')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('رفض'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    try {
      await ref.read(dioProvider).patch(Endpoints.bookingReject(booking.id));
      ref.invalidate(tripBookingsProvider(booking.tripId));
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تم رفض الحجز')),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final passenger = booking.passenger;
    final rawName = passenger?.fullName ?? '';
    final name = rawName.isNotEmpty ? rawName : 'راكب';
    final rating = passenger?.ratingAverage ?? 0.0;
    final ratingCount = passenger?.ratingCount ?? 0;
    final canRate = booking.canRate;

    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: booking.passengerId.isNotEmpty
            ? () => context.push('/users/${booking.passengerId}')
            : null,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CircleAvatar(
                    radius: 24,
                    backgroundColor: AppColors.primary.withOpacity(0.1),
                    child: Text(
                      name.isNotEmpty ? name[0] : '?',
                      style: const TextStyle(
                          color: AppColors.primary, fontWeight: FontWeight.bold),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(name,
                            style: const TextStyle(fontWeight: FontWeight.bold)),
                        if (ratingCount > 0)
                          RatingStars(rating: rating, count: ratingCount)
                        else
                          Text('لا يوجد تقييم بعد',
                              style:
                                  TextStyle(color: Colors.grey[600], fontSize: 12)),
                        Text(
                          '${booking.seatsCount} مقعد · ${booking.totalAmount.toStringAsFixed(0)} جنيه',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                  if (booking.status == 'pending_driver_approval')
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        FilledButton(
                          style: FilledButton.styleFrom(
                              backgroundColor: AppColors.primary,
                              minimumSize: const Size(60, 32)),
                          onPressed: () => _approveBooking(context, ref, booking),
                          child: const Text('قبول', style: TextStyle(fontSize: 12)),
                        ),
                        const SizedBox(width: 6),
                        OutlinedButton(
                          style: OutlinedButton.styleFrom(
                              foregroundColor: Colors.red,
                              minimumSize: const Size(60, 32)),
                          onPressed: () => _rejectBooking(context, ref, booking),
                          child: const Text('رفض', style: TextStyle(fontSize: 12)),
                        ),
                      ],
                    )
                  else if (canRate)
                    FilledButton.tonal(
                      onPressed: () =>
                          context.push('/bookings/rate', extra: booking),
                      child: const Text('قيّم'),
                    )
                  else if (booking.isCompleted)
                    Text('تم التقييم',
                        style: TextStyle(color: Colors.grey[600], fontSize: 12))
                  else
                    const Icon(Icons.chevron_left_rounded, color: Colors.grey),
                ],
              ),
              if (booking.canDispute) ...[
                const SizedBox(height: 8),
                Align(
                  alignment: AlignmentDirectional.centerEnd,
                  child: TextButton.icon(
                    icon: const Icon(Icons.report_outlined, size: 16),
                    label: const Text('فتح نزاع'),
                    style: TextButton.styleFrom(
                        foregroundColor: Colors.deepOrange),
                    onPressed: () => context.push(
                      '/disputes/open?bookingId=${booking.id}&role=driver',
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
