import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/models/trip.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../shared/widgets/app_button.dart';
import '../../../../features/auth/providers/auth_provider.dart';
import '../../providers/bookings_provider.dart';
import '../../../../core/services/analytics_service.dart';

class BookingConfirmScreen extends ConsumerStatefulWidget {
  final Trip trip;
  final int initialSeats;
  const BookingConfirmScreen({super.key, required this.trip, required this.initialSeats});

  @override
  ConsumerState<BookingConfirmScreen> createState() => _BookingConfirmScreenState();
}

class _BookingConfirmScreenState extends ConsumerState<BookingConfirmScreen> {
  late int _seats;
  String _paymentMethod = 'cash';
  bool _usePromo = false;

  @override
  void initState() {
    super.initState();
    _seats = widget.initialSeats;
  }

  double get _grossTotal => widget.trip.pricePerSeat * _seats;
  double get _promoDiscount {
    if (!_usePromo) return 0;
    final balance = ref.watch(authProvider).user?.promoBalance ?? 0;
    return balance > _grossTotal ? _grossTotal : balance;
  }
  double get _total => _grossTotal - _promoDiscount;

  Future<void> _confirm() async {
    if (widget.trip.womenOnly) {
      final gender = ref.read(authProvider).user?.gender ?? 'male';
      if (gender != 'female') {
        if (!mounted) return;
        final proceed = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('رحلة للسيدات فقط'),
            content: const Text(
              'هذه الرحلة مخصصة للسيدات فقط. جنسك المُسجَّل ليس أنثى. '
              'هل تريد المتابعة على مسؤوليتك الخاصة؟',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('إلغاء'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('متابعة'),
              ),
            ],
          ),
        );
        if (proceed != true) return;
      }
    }

    final notifier = ref.read(createBookingProvider.notifier);
    final booking = await notifier.create({
      'tripId': widget.trip.id,
      'seatsCount': _seats,
      'paymentMethod': _paymentMethod,
      if (_usePromo) 'usePromo': true,
    });
    if (!mounted) return;
    if (booking == null) return;

    AnalyticsService.logBookingConfirmed(
      tripId: widget.trip.id,
      seats: _seats,
      amount: _total,
    ).ignore();

    if (!mounted) return;

    // Online payment: navigate to the Kashier payment screen
    if (booking.paymentUrl != null) {
      context.push('/bookings/payment', extra: {
        'bookingId': booking.id,
        'paymentUrl': booking.paymentUrl,
      });
      return;
    }

    // Cash: go straight to my bookings
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('تم إرسال طلب الحجز! سيردّ السائق خلال 30 دقيقة')),
    );
    context.go('/my-bookings');
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(createBookingProvider);
    final loading = state is AsyncLoading;
    String? error;
    if (state is AsyncError) error = state.error.toString();

    return Scaffold(
      appBar: AppBar(title: const Text('تأكيد الحجز')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${widget.trip.originCity} ← ${widget.trip.destinationCity}',
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      _fmtDateTime(widget.trip.departureTime),
                      style: TextStyle(color: Colors.grey[600]),
                    ),
                    const SizedBox(height: 8),
                    Text('السائق: ${widget.trip.driver.fullName}'),
                    Text(widget.trip.driver.vehicleLabel),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    Row(
                      children: [
                        const Text('عدد المقاعد', style: TextStyle(fontSize: 16)),
                        const Spacer(),
                        IconButton(
                          icon: const Icon(Icons.remove_circle_outline_rounded),
                          onPressed: _seats > 1 ? () => setState(() => _seats--) : null,
                        ),
                        Text('$_seats',
                            style: const TextStyle(
                                fontSize: 20, fontWeight: FontWeight.bold)),
                        IconButton(
                          icon: const Icon(Icons.add_circle_outline_rounded),
                          onPressed: _seats < widget.trip.availableSeats
                              ? () => setState(() => _seats++)
                              : null,
                        ),
                      ],
                    ),
                    const Divider(),
                    const SizedBox(height: 4),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('الإجمالي', style: TextStyle(fontSize: 16)),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            if (_usePromo && _promoDiscount > 0)
                              Text(
                                '${_grossTotal.toStringAsFixed(0)} جنيه',
                                style: TextStyle(
                                  fontSize: 14,
                                  color: Colors.grey[500],
                                  decoration: TextDecoration.lineThrough,
                                ),
                              ),
                            Text(
                              '${_total.toStringAsFixed(0)} جنيه',
                              style: const TextStyle(
                                  fontSize: 22,
                                  fontWeight: FontWeight.bold,
                                  color: AppColors.primary),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            Builder(builder: (context) {
              final promoBalance = ref.watch(authProvider).user?.promoBalance ?? 0;
              if (promoBalance <= 0) return const SizedBox.shrink();
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Card(
                    color: Colors.green.shade50,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                      child: Row(
                        children: [
                          Icon(Icons.card_giftcard_rounded, color: Colors.green.shade700),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'رصيد العروض: ${promoBalance.toStringAsFixed(0)} جنيه',
                                  style: TextStyle(
                                      fontWeight: FontWeight.bold,
                                      color: Colors.green.shade800),
                                ),
                                if (_usePromo && _promoDiscount > 0)
                                  Text(
                                    'خصم: ${_promoDiscount.toStringAsFixed(0)} جنيه',
                                    style: TextStyle(
                                        fontSize: 12, color: Colors.green.shade700),
                                  ),
                              ],
                            ),
                          ),
                          Switch(
                            value: _usePromo,
                            activeColor: Colors.green.shade700,
                            onChanged: (v) => setState(() => _usePromo = v),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                ],
              );
            }),
            // Payment method selector
            const Text('طريقة الدفع', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
            const SizedBox(height: 8),
            _PaymentMethodPicker(
              selected: _paymentMethod,
              onChanged: (v) => setState(() => _paymentMethod = v),
            ),
            const SizedBox(height: 12),
            // Info banner
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.blue.shade50,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(children: [
                Icon(Icons.info_outline_rounded, color: Colors.blue.shade700, size: 18),
                const SizedBox(width: 8),
                Expanded(child: Text(
                  _paymentMethod == 'cash'
                      ? 'سيتم الدفع للسائق نقداً عند الصعود. السائق لديه 30 دقيقة للموافقة على طلبك.'
                      : 'سيتم الحجز عند إتمام الدفع الإلكتروني.',
                  style: TextStyle(fontSize: 12, color: Colors.blue.shade700),
                )),
              ]),
            ),
            // The passenger has to see what they actually get back before paying —
            // the previous wording promised an automatic full refund, which is not
            // the policy the backend applies.
            if (_paymentMethod != 'cash') ...[
              const SizedBox(height: 8),
              const _CancellationPolicyNotice(),
            ],
            if (error != null) ...[
              const SizedBox(height: 8),
              Text(error, style: const TextStyle(color: Colors.red, fontSize: 13)),
            ],
            const SizedBox(height: 24),
            AppButton(
              label: _paymentMethod == 'cash' ? 'طلب حجز' : 'المتابعة للدفع',
              loading: loading,
              onPressed: _confirm,
            ),
          ],
        ),
      ),
    );
  }

  String _fmtDateTime(DateTime dt) =>
      '${dt.day}/${dt.month}/${dt.year} '
      '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
}

class _PaymentMethodPicker extends StatelessWidget {
  final String selected;
  final ValueChanged<String> onChanged;
  const _PaymentMethodPicker({required this.selected, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _Chip(
          label: 'كاش',
          icon: Icons.payments_outlined,
          value: 'cash',
          selected: selected,
          onTap: onChanged,
        ),
        const SizedBox(width: 8),
        _Chip(
          label: 'فودافون كاش',
          icon: Icons.phone_android_rounded,
          value: 'vodafone_cash',
          selected: selected,
          onTap: onChanged,
        ),
        const SizedBox(width: 8),
        _Chip(
          label: 'بطاقة',
          icon: Icons.credit_card_rounded,
          value: 'card',
          selected: selected,
          onTap: onChanged,
        ),
      ],
    );
  }
}

class _Chip extends StatelessWidget {
  final String label;
  final IconData icon;
  final String value;
  final String selected;
  final ValueChanged<String> onTap;
  const _Chip({
    required this.label,
    required this.icon,
    required this.value,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final isSelected = selected == value;
    final color = isSelected ? AppColors.primary : Colors.grey[400]!;
    return GestureDetector(
      onTap: () => onTap(value),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: isSelected ? AppColors.primary.withValues(alpha: 0.08) : Colors.transparent,
          border: Border.all(color: color),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 16, color: color),
            const SizedBox(width: 4),
            Text(label, style: TextStyle(fontSize: 12, color: color, fontWeight: FontWeight.w600)),
          ],
        ),
      ),
    );
  }
}


/// Shows the actual refund tiers before payment. Kashier's merchant contract requires
/// a refund policy the customer can see and accept beforehand, and the thresholds are
/// admin-configurable, so they are read from the server rather than restated here.
class _CancellationPolicyNotice extends ConsumerWidget {
  const _CancellationPolicyNotice();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final policy = ref.watch(cancellationPolicyProvider);

    return policy.when(
      loading: () => const SizedBox.shrink(),
      error: (_, __) => const SizedBox.shrink(),
      data: (p) {
        final free = p.freeCancelHours.toStringAsFixed(0);
        final late = p.lateCancelHours.toStringAsFixed(0);
        return Container(
          width: double.infinity,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Colors.amber.shade50,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: Colors.amber.shade200),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                Icon(Icons.policy_outlined,
                    size: 18, color: Colors.amber.shade900),
                const SizedBox(width: 8),
                Text('سياسة الإلغاء والاسترداد',
                    style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.bold,
                        color: Colors.amber.shade900)),
              ]),
              const SizedBox(height: 8),
              _PolicyRow(text: 'الإلغاء قبل $free ساعة من الموعد: استرداد كامل المبلغ.'),
              _PolicyRow(
                  text:
                      'الإلغاء بين $late و$free ساعة: استرداد المبلغ بعد خصم ${p.feePercent}% رسوم إلغاء.'),
              _PolicyRow(
                  text:
                      'الإلغاء خلال أقل من $late ساعة أو بعد بدء الرحلة: لا يوجد استرداد.'),
              const SizedBox(height: 6),
              Text(
                'سيظهر لك المبلغ المسترد بالضبط قبل تأكيد الإلغاء.',
                style: TextStyle(fontSize: 11, color: Colors.grey.shade700),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _PolicyRow extends StatelessWidget {
  final String text;
  const _PolicyRow({required this.text});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('•  ', style: TextStyle(fontSize: 12)),
          Expanded(
            child: Text(text, style: const TextStyle(fontSize: 12, height: 1.4)),
          ),
        ],
      ),
    );
  }
}
