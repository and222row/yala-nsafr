import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/models/dispute.dart';
import '../../../../core/theme/app_theme.dart';
import '../../providers/disputes_provider.dart';

class DisputesScreen extends ConsumerWidget {
  const DisputesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final disputesAsync = ref.watch(myDisputesProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('نزاعاتي')),
      body: disputesAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('$e')),
        data: (disputes) {
          if (disputes.isEmpty) {
            return const Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.gavel_rounded, size: 72, color: Colors.grey),
                  SizedBox(height: 12),
                  Text('لا توجد نزاعات',
                      style: TextStyle(fontSize: 16, color: Colors.grey)),
                ],
              ),
            );
          }
          return RefreshIndicator(
            onRefresh: () => ref.refresh(myDisputesProvider.future),
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: disputes.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (_, i) => _DisputeCard(dispute: disputes[i]),
            ),
          );
        },
      ),
    );
  }
}

class _DisputeCard extends StatelessWidget {
  final Dispute dispute;
  const _DisputeCard({required this.dispute});

  Color get _statusColor => dispute.isResolved
      ? Colors.grey
      : dispute.status == 'under_review'
          ? Colors.orange
          : AppColors.primary;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => context.push('/disputes/${dispute.id}'),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      _reasonLabel(dispute.reason),
                      style: const TextStyle(
                          fontWeight: FontWeight.bold, fontSize: 15),
                    ),
                  ),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                    decoration: BoxDecoration(
                      color: _statusColor.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: _statusColor),
                    ),
                    child: Text(dispute.statusLabel,
                        style: TextStyle(color: _statusColor, fontSize: 12)),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                dispute.description,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: Colors.grey[700], fontSize: 13),
              ),
              const SizedBox(height: 8),
              Text(
                _fmtDate(dispute.createdAt),
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _reasonLabel(String reason) => switch (reason) {
        'driver_no_show' => 'السائق لم يحضر',
        'passenger_no_show' => 'الراكب لم يحضر',
        'route_changed' => 'تغيير المسار',
        'safety_concern' => 'مشكلة أمان',
        'payment_issue' => 'مشكلة دفع',
        'behavior_issue' => 'مشكلة سلوكية',
        'other' => 'أخرى',
        _ => reason,
      };

  String _fmtDate(DateTime d) => '${d.day}/${d.month}/${d.year}';
}
