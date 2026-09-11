import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/models/dispute.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../features/auth/providers/auth_provider.dart';
import '../../../../shared/widgets/app_button.dart';
import '../../providers/disputes_provider.dart';

class DisputeDetailScreen extends ConsumerStatefulWidget {
  final String disputeId;
  const DisputeDetailScreen({super.key, required this.disputeId});

  @override
  ConsumerState<DisputeDetailScreen> createState() => _DisputeDetailScreenState();
}

class _DisputeDetailScreenState extends ConsumerState<DisputeDetailScreen> {
  final _responseCtrl = TextEditingController();
  bool _showReply = false;

  @override
  void dispose() {
    _responseCtrl.dispose();
    super.dispose();
  }

  Future<void> _sendResponse(String disputeId) async {
    if (_responseCtrl.text.trim().isEmpty) return;
    final ok = await ref
        .read(respondDisputeProvider.notifier)
        .respond(disputeId, _responseCtrl.text.trim());
    if (ok && mounted) {
      ref.refresh(disputeDetailProvider(disputeId));
      setState(() => _showReply = false);
      _responseCtrl.clear();
    }
  }

  @override
  Widget build(BuildContext context) {
    final disputeAsync = ref.watch(disputeDetailProvider(widget.disputeId));
    final myId = ref.watch(authProvider).user?.id;

    return Scaffold(
      appBar: AppBar(title: const Text('تفاصيل النزاع')),
      body: disputeAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('$e')),
        data: (dispute) => _Body(
          dispute: dispute,
          myId: myId ?? '',
          responseCtrl: _responseCtrl,
          showReply: _showReply,
          onToggleReply: () => setState(() => _showReply = !_showReply),
          onSendResponse: () => _sendResponse(dispute.id),
          respondState: ref.watch(respondDisputeProvider),
        ),
      ),
    );
  }
}

class _Body extends StatelessWidget {
  final Dispute dispute;
  final String myId;
  final TextEditingController responseCtrl;
  final bool showReply;
  final VoidCallback onToggleReply;
  final VoidCallback onSendResponse;
  final AsyncValue<void> respondState;

  const _Body({
    required this.dispute,
    required this.myId,
    required this.responseCtrl,
    required this.showReply,
    required this.onToggleReply,
    required this.onSendResponse,
    required this.respondState,
  });

  @override
  Widget build(BuildContext context) {
    final isOpener = dispute.openedByUserId == myId;
    final canRespond = !isOpener &&
        dispute.isOpen &&
        dispute.otherPartyResponse == null;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Status chip
          Center(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              decoration: BoxDecoration(
                color: (dispute.isResolved ? Colors.grey : AppColors.primary)
                    .withOpacity(0.1),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                    color: dispute.isResolved ? Colors.grey : AppColors.primary),
              ),
              child: Text(
                dispute.statusLabel,
                style: TextStyle(
                  color: dispute.isResolved ? Colors.grey : AppColors.primary,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ),
          const SizedBox(height: 20),

          _Card(
            title: 'تفاصيل الشكوى',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(dispute.description),
                if (dispute.evidenceUrls.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Text('الأدلة المقدمة: ${dispute.evidenceUrls.length} ملف',
                      style: const TextStyle(color: Colors.grey, fontSize: 13)),
                ],
              ],
            ),
          ),
          const SizedBox(height: 12),

          if (dispute.otherPartyResponse != null)
            _Card(
              title: isOpener ? 'رد الطرف الآخر' : 'ردك',
              child: Text(dispute.otherPartyResponse!),
            ),

          if (dispute.isResolved && dispute.resolutionNotes != null) ...[
            const SizedBox(height: 12),
            _Card(
              title: 'قرار الإدارة',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(dispute.resolutionNotes!),
                  if (dispute.refundAmount != null) ...[
                    const SizedBox(height: 8),
                    Text(
                      'المبلغ المسترد: ${dispute.refundAmount!.toStringAsFixed(0)} جنيه',
                      style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          color: AppColors.primary),
                    ),
                  ],
                ],
              ),
            ),
          ],

          if (canRespond) ...[
            const SizedBox(height: 20),
            if (!showReply)
              AppButton(
                label: 'الرد على النزاع',
                outlined: true,
                onPressed: onToggleReply,
              )
            else ...[
              TextFormField(
                controller: responseCtrl,
                decoration: const InputDecoration(
                  labelText: 'ردك على الشكوى',
                  hintText: 'اشرح وجهة نظرك...',
                ),
                maxLines: 4,
                maxLength: 1000,
              ),
              const SizedBox(height: 12),
              AppButton(
                label: 'إرسال الرد',
                loading: respondState is AsyncLoading,
                onPressed: onSendResponse,
              ),
              const SizedBox(height: 8),
              AppButton(
                label: 'إلغاء',
                outlined: true,
                onPressed: onToggleReply,
              ),
            ],
          ],
        ],
      ),
    );
  }
}

class _Card extends StatelessWidget {
  final String title;
  final Widget child;
  const _Card({required this.title, required this.child});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title,
                style: Theme.of(context)
                    .textTheme
                    .titleSmall
                    ?.copyWith(color: Colors.grey[600])),
            const SizedBox(height: 8),
            child,
          ],
        ),
      ),
    );
  }
}
