import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/models/earnings.dart';
import '../../../../core/theme/app_theme.dart';
import '../../providers/earnings_provider.dart';

class DriverEarningsScreen extends ConsumerWidget {
  const DriverEarningsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final summaryAsync = ref.watch(earningsSummaryProvider);
    final tripsAsync = ref.watch(earningsTripsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('أرباحي')),
      body: summaryAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('$e')),
        data: (summary) => Column(
          children: [
            _SummaryStrip(summary: summary),
            Expanded(
              child: tripsAsync.when(
                loading: () =>
                    const Center(child: CircularProgressIndicator()),
                error: (e, _) => Center(child: Text('$e')),
                data: (trips) {
                  if (trips.isEmpty) {
                    return const Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.directions_car_outlined,
                              size: 56, color: Colors.grey),
                          SizedBox(height: 12),
                          Text('لا توجد رحلات مكتملة بعد',
                              style: TextStyle(color: Colors.grey)),
                        ],
                      ),
                    );
                  }
                  return RefreshIndicator(
                    onRefresh: () async {
                      ref.invalidate(earningsSummaryProvider);
                      ref.invalidate(earningsTripsProvider);
                    },
                    child: ListView.separated(
                      padding: const EdgeInsets.all(16),
                      itemCount: trips.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (_, i) => _TripEarningCard(trip: trips[i]),
                    ),
                  );
                },
              ),
            ),
            _WithdrawBar(summary: summary),
          ],
        ),
      ),
    );
  }
}

// ── Summary strip ─────────────────────────────────────────────────────────────

class _SummaryStrip extends StatelessWidget {
  final EarningsSummary summary;
  const _SummaryStrip({required this.summary});

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.primary,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: _SummaryCard(
                  label: 'هذا الشهر',
                  value: summary.thisMonthTotal,
                  icon: Icons.calendar_month_rounded,
                  highlight: true,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _SummaryCard(
                  label: 'إجمالي الأرباح',
                  value: summary.allTimeTotal,
                  icon: Icons.account_balance_wallet_rounded,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.15),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'الرصيد المتاح للسحب',
                  style: TextStyle(
                      color: Colors.white.withOpacity(0.9), fontSize: 13),
                ),
                Text(
                  '${summary.pendingBalance.toStringAsFixed(0)} ج',
                  style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                      fontSize: 18),
                ),
              ],
            ),
          ),
          // Without this the balance appears to have shrunk for no reason while a
          // transfer is settling
          if (summary.pendingWithdrawal > 0) ...[
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.schedule_rounded,
                    size: 14, color: Colors.white.withOpacity(0.9)),
                const SizedBox(width: 6),
                Text(
                  'قيد التحويل: ${summary.pendingWithdrawal.toStringAsFixed(0)} ج',
                  style: TextStyle(
                      color: Colors.white.withOpacity(0.9), fontSize: 12),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _SummaryCard extends StatelessWidget {
  final String label;
  final double value;
  final IconData icon;
  final bool highlight;

  const _SummaryCard({
    required this.label,
    required this.value,
    required this.icon,
    this.highlight = false,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: highlight
            ? Colors.white.withOpacity(0.2)
            : Colors.white.withOpacity(0.1),
        borderRadius: BorderRadius.circular(14),
        border: highlight
            ? Border.all(color: Colors.white.withOpacity(0.4), width: 1.5)
            : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: Colors.white, size: 20),
          const SizedBox(height: 8),
          Text(
            '${value.toStringAsFixed(0)} ج',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 4),
          Text(label,
              style: TextStyle(
                  color: Colors.white.withOpacity(0.85), fontSize: 12)),
        ],
      ),
    );
  }
}

// ── Withdraw bar ──────────────────────────────────────────────────────────────

class _WithdrawBar extends StatelessWidget {
  final EarningsSummary summary;
  const _WithdrawBar({required this.summary});

  @override
  Widget build(BuildContext context) {
    final canWithdraw = summary.pendingBalance >= summary.minWithdrawal;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (!canWithdraw)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text(
                  'الحد الأدنى للسحب ${summary.minWithdrawal.toStringAsFixed(0)} ج'
                  ' — رصيدك ${summary.pendingBalance.toStringAsFixed(0)} ج',
                  style:
                      TextStyle(color: Colors.grey.shade600, fontSize: 12),
                  textAlign: TextAlign.center,
                ),
              ),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                icon: const Icon(Icons.account_balance_rounded),
                label: const Text('طلب سحب الأرباح'),
                onPressed: canWithdraw
                    ? () => _showWithdrawSheet(context, summary)
                    : null,
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _showWithdrawSheet(BuildContext context, EarningsSummary summary) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _WithdrawSheet(summary: summary),
    );
  }
}

// ── Withdrawal form sheet ─────────────────────────────────────────────────────

class _WithdrawSheet extends ConsumerStatefulWidget {
  final EarningsSummary summary;
  const _WithdrawSheet({required this.summary});

  @override
  ConsumerState<_WithdrawSheet> createState() => _WithdrawSheetState();
}

class _WithdrawSheetState extends ConsumerState<_WithdrawSheet> {
  final _formKey = GlobalKey<FormState>();
  final _amountCtrl = TextEditingController();
  final _accountCtrl = TextEditingController();
  final _nameCtrl = TextEditingController();
  final _bankCtrl = TextEditingController();

  String _method = 'vodafone_cash';
  bool _loading = false;

  static const _methods = [
    ('vodafone_cash', 'فودافون كاش'),
    ('instapay', 'إنستاباي'),
    ('bank', 'تحويل بنكي'),
  ];

  @override
  void dispose() {
    _amountCtrl.dispose();
    _accountCtrl.dispose();
    _nameCtrl.dispose();
    _bankCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _loading = true);
    try {
      await requestWithdrawal(
        ref,
        amount: double.parse(_amountCtrl.text.trim()),
        payoutMethod: _method,
        payoutAccount: _accountCtrl.text.trim(),
        payoutName: _nameCtrl.text.trim(),
        payoutBank: _method == 'bank' ? _bankCtrl.text.trim() : null,
      );
      if (mounted) {
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('تم إرسال طلب السحب بنجاح ✅'),
              backgroundColor: Colors.green),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text(e is ApiException ? e.message : '$e'),
              backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final insets = MediaQuery.of(context).viewInsets;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + insets.bottom),
      child: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                    color: Colors.grey.shade300,
                    borderRadius: BorderRadius.circular(2)),
              ),
            ),
            const SizedBox(height: 16),
            Text('طلب سحب الأرباح',
                style: Theme.of(context)
                    .textTheme
                    .titleLarge
                    ?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 4),
            Text(
              'الرصيد المتاح: ${widget.summary.pendingBalance.toStringAsFixed(0)} ج',
              style:
                  TextStyle(color: Colors.grey.shade600, fontSize: 13),
            ),
            const SizedBox(height: 20),

            // Amount
            TextFormField(
              controller: _amountCtrl,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'المبلغ (جنيه)',
                prefixIcon: Icon(Icons.payments_outlined),
                border: OutlineInputBorder(),
              ),
              validator: (v) {
                final n = double.tryParse(v ?? '');
                if (n == null) return 'أدخل مبلغاً صحيحاً';
                if (n < widget.summary.minWithdrawal) {
                  return 'الحد الأدنى ${widget.summary.minWithdrawal.toStringAsFixed(0)} ج';
                }
                if (n > widget.summary.pendingBalance) {
                  return 'يتجاوز رصيدك المتاح';
                }
                return null;
              },
            ),
            const SizedBox(height: 14),

            // Method
            DropdownButtonFormField<String>(
              value: _method,
              decoration: const InputDecoration(
                labelText: 'طريقة الاستلام',
                prefixIcon: Icon(Icons.account_balance_wallet_outlined),
                border: OutlineInputBorder(),
              ),
              items: _methods
                  .map((m) => DropdownMenuItem(value: m.$1, child: Text(m.$2)))
                  .toList(),
              onChanged: (v) => setState(() => _method = v!),
            ),
            const SizedBox(height: 14),

            // Account number
            TextFormField(
              controller: _accountCtrl,
              keyboardType: TextInputType.phone,
              decoration: InputDecoration(
                labelText: _method == 'bank' ? 'رقم الحساب / IBAN' : 'رقم المحفظة',
                prefixIcon: const Icon(Icons.phone_android_outlined),
                border: const OutlineInputBorder(),
              ),
              validator: (v) {
                if (v == null || v.trim().length < 11) return 'أدخل رقماً صحيحاً';
                return null;
              },
            ),
            const SizedBox(height: 14),

            // Full name
            TextFormField(
              controller: _nameCtrl,
              decoration: const InputDecoration(
                labelText: 'الاسم الكامل',
                prefixIcon: Icon(Icons.person_outline),
                border: OutlineInputBorder(),
              ),
              validator: (v) =>
                  (v == null || v.trim().length < 2) ? 'أدخل الاسم' : null,
            ),

            // Bank name (only for bank transfer)
            if (_method == 'bank') ...[
              const SizedBox(height: 14),
              TextFormField(
                controller: _bankCtrl,
                decoration: const InputDecoration(
                  labelText: 'اسم البنك',
                  prefixIcon: Icon(Icons.account_balance_outlined),
                  border: OutlineInputBorder(),
                ),
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'أدخل اسم البنك' : null,
              ),
            ],

            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: _loading ? null : _submit,
                child: _loading
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : const Text('إرسال الطلب'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Trip earning card ─────────────────────────────────────────────────────────

class _TripEarningCard extends StatelessWidget {
  final TripEarning trip;
  const _TripEarningCard({required this.trip});

  @override
  Widget build(BuildContext context) {
    final isCash = trip.isCash;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    '${trip.originCity} ← ${trip.destinationCity}',
                    style: const TextStyle(
                        fontWeight: FontWeight.bold, fontSize: 15),
                  ),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: (isCash ? Colors.teal : Colors.blue).withOpacity(0.1),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                        color: (isCash ? Colors.teal : Colors.blue)
                            .withOpacity(0.4)),
                  ),
                  child: Text(isCash ? 'نقدي' : 'أونلاين',
                      style: TextStyle(
                          color: isCash ? Colors.teal : Colors.blue,
                          fontSize: 11)),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              _fmtDate(trip.departureTime),
              style: TextStyle(color: Colors.grey[600], fontSize: 12),
            ),
            const Divider(height: 20),
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(isCash ? 'محصّل نقداً' : 'صافي الربح',
                          style: TextStyle(
                              color: Colors.grey[600], fontSize: 11)),
                      const SizedBox(height: 2),
                      Text(
                        '${(isCash ? trip.totalAmount : trip.driverPayoutAmount).toStringAsFixed(0)} ج',
                        style: TextStyle(
                            color: isCash ? Colors.teal : Colors.blue,
                            fontWeight: FontWeight.bold,
                            fontSize: 18),
                      ),
                    ],
                  ),
                ),
                if (trip.seatsCount > 1)
                  Text(
                    '${trip.seatsCount} مقاعد',
                    style:
                        TextStyle(color: Colors.grey[500], fontSize: 12),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  String _fmtDate(DateTime dt) =>
      '${dt.day}/${dt.month}/${dt.year}  '
      '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
}
