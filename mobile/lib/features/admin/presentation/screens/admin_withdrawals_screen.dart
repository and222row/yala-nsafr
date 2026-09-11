import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_endpoints.dart';
import '../widgets/admin_scaffold.dart';

final _withdrawalsProvider =
    FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final resp =
      await ref.read(dioProvider).get(Endpoints.adminWithdrawals);
  return (resp.data as List).cast<Map<String, dynamic>>();
});

class AdminWithdrawalsScreen extends ConsumerWidget {
  const AdminWithdrawalsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(_withdrawalsProvider);
    return AdminScaffold(
      title: 'طلبات السحب',
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('$e')),
        data: (items) {
          if (items.isEmpty) {
            return const Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.check_circle_rounded,
                      size: 64, color: Colors.green),
                  SizedBox(height: 12),
                  Text('لا توجد طلبات معلقة',
                      style: TextStyle(color: Colors.grey, fontSize: 15)),
                ],
              ),
            );
          }
          return RefreshIndicator(
            onRefresh: () => ref.refresh(_withdrawalsProvider.future),
            child: ListView.separated(
              padding: const EdgeInsets.all(14),
              itemCount: items.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (_, i) => _WithdrawalCard(
                item: items[i],
                onSettle: (action, note) async {
                  try {
                    await ref.read(dioProvider).patch(
                      Endpoints.adminWithdrawalById(items[i]['id'] as String),
                      data: {
                        'action': action,
                        if (note != null && note.isNotEmpty) 'adminNote': note,
                      },
                    );
                    ref.invalidate(_withdrawalsProvider);
                  } catch (e) {
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('$e')));
                    }
                  }
                },
              ),
            ),
          );
        },
      ),
    );
  }
}

class _WithdrawalCard extends StatelessWidget {
  final Map<String, dynamic> item;
  final Future<void> Function(String action, String? note) onSettle;
  const _WithdrawalCard({required this.item, required this.onSettle});

  String _fmtDate(String? raw) {
    if (raw == null) return '-';
    final dt = DateTime.tryParse(raw);
    if (dt == null) return raw;
    return '${dt.day}/${dt.month}/${dt.year}';
  }

  String _payoutLabel(String? method) => switch (method) {
        'instapay' => 'InstaPay',
        'bank_transfer' => 'تحويل بنكي',
        'vodafone_cash' => 'Vodafone Cash',
        _ => method ?? '-',
      };

  Future<void> _showNoteDialog(
      BuildContext context, String action, String actionLabel) async {
    final noteCtrl = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('$actionLabel الطلب'),
        content: TextField(
          controller: noteCtrl,
          decoration: const InputDecoration(
            labelText: 'ملاحظة (اختياري)',
          ),
          maxLines: 2,
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('إلغاء')),
          FilledButton(
            style: action == 'reject'
                ? FilledButton.styleFrom(backgroundColor: Colors.red)
                : null,
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(actionLabel),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await onSettle(action, noteCtrl.text.trim());
    }
    noteCtrl.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final driver =
        item['driver'] as Map<String, dynamic>? ?? {};

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.person_rounded, size: 16, color: Colors.grey),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    driver['fullName'] as String? ?? '-',
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                ),
                Text(
                  _fmtDate(item['createdAt'] as String?),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(driver['phoneNumber'] as String? ?? '',
                style: Theme.of(context).textTheme.bodySmall),
            const Divider(height: 16),
            Row(
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${item['amount'] ?? '-'} جنيه',
                      style: const TextStyle(
                          fontSize: 20, fontWeight: FontWeight.bold),
                    ),
                    Text(
                      _payoutLabel(item['payoutMethod'] as String?),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    Text(
                      item['payoutAccount'] as String? ?? '-',
                      style: const TextStyle(
                          fontFamily: 'monospace', fontSize: 13),
                    ),
                  ],
                ),
                const Spacer(),
                Column(
                  children: [
                    FilledButton.icon(
                      icon: const Icon(Icons.check_rounded, size: 16),
                      label: const Text('صرف'),
                      onPressed: () =>
                          _showNoteDialog(context, 'pay', 'صرف'),
                    ),
                    const SizedBox(height: 6),
                    OutlinedButton.icon(
                      icon: const Icon(Icons.close_rounded, size: 16),
                      label: const Text('رفض'),
                      style: OutlinedButton.styleFrom(
                          foregroundColor: Colors.red,
                          side: const BorderSide(color: Colors.red)),
                      onPressed: () =>
                          _showNoteDialog(context, 'reject', 'رفض'),
                    ),
                  ],
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
