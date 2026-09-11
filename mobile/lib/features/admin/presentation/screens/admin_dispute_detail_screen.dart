import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_endpoints.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../shared/widgets/app_button.dart';

// ── Providers ──────────────────────────────────────────────────────────────────

final _adminDisputeDetailProvider =
    FutureProvider.autoDispose.family<Map<String, dynamic>, String>(
  (ref, id) async {
    final dio = ref.read(dioProvider);
    final res = await dio.get(Endpoints.adminDisputeById(id));
    return res.data as Map<String, dynamic>;
  },
);

// ── Screen ────────────────────────────────────────────────────────────────────

class AdminDisputeDetailScreen extends ConsumerStatefulWidget {
  final String disputeId;
  const AdminDisputeDetailScreen({super.key, required this.disputeId});

  @override
  ConsumerState<AdminDisputeDetailScreen> createState() =>
      _AdminDisputeDetailScreenState();
}

class _AdminDisputeDetailScreenState
    extends ConsumerState<AdminDisputeDetailScreen> {
  // Notify
  String _notifyTarget = 'both';
  final _msgCtrl = TextEditingController();
  bool _sendingMsg = false;

  // Resolve
  final _notesCtrl = TextEditingController();
  final _refundCtrl = TextEditingController();
  bool _resolving = false;
  bool _blockPassenger = false;
  bool _blockDriver = false;
  bool _banInsteadOfSuspend = false;

  @override
  void dispose() {
    _msgCtrl.dispose();
    _notesCtrl.dispose();
    _refundCtrl.dispose();
    super.dispose();
  }

  Future<void> _notify() async {
    if (_msgCtrl.text.trim().isEmpty) return;
    setState(() => _sendingMsg = true);
    try {
      final dio = ref.read(dioProvider);
      await dio.post(Endpoints.adminDisputeNotify(widget.disputeId), data: {
        'target': _notifyTarget,
        'message': _msgCtrl.text.trim(),
      });
      if (!mounted) return;
      _msgCtrl.clear();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم إرسال الرسالة')),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _sendingMsg = false);
    }
  }

  Future<void> _resolve(
    Map<String, dynamic> detail,
    String resolution,
  ) async {
    if (_notesCtrl.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('اكتب ملاحظات القرار أولاً')),
      );
      return;
    }

    final booking = detail['booking'] as Map<String, dynamic>?;
    final passengerId = booking?['passenger']?['id'] as String?;
    final driverId = booking?['trip']?['driver']?['id'] as String?;
    final blockStatus = _banInsteadOfSuspend ? 'banned' : 'suspended';

    // Determine which user to block (if any)
    String? blockUserId;
    if (_blockPassenger && passengerId != null) blockUserId = passengerId;
    if (_blockDriver && driverId != null) blockUserId = driverId;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('تأكيد القرار'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(_resolutionLabel(resolution)),
            if (blockUserId != null) ...[
              const SizedBox(height: 8),
              Text(
                'سيتم ${_banInsteadOfSuspend ? 'حظر' : 'إيقاف'} '
                '${_blockPassenger ? 'الراكب' : 'السائق'} من المنصة.',
                style: const TextStyle(color: Colors.red),
              ),
            ],
          ],
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('إلغاء')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('تأكيد')),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _resolving = true);
    try {
      final dio = ref.read(dioProvider);
      await dio.post(Endpoints.adminDisputeResolve(widget.disputeId), data: {
        'resolution': resolution,
        'resolutionNotes': _notesCtrl.text.trim(),
        if (resolution == 'resolved_split' &&
            _refundCtrl.text.trim().isNotEmpty)
          'refundAmount': double.tryParse(_refundCtrl.text.trim()) ?? 0,
        if (blockUserId != null) 'blockUserId': blockUserId,
        if (blockUserId != null) 'blockStatus': blockStatus,
      });
      if (!mounted) return;
      ref.invalidate(_adminDisputeDetailProvider(widget.disputeId));
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم البت في النزاع')),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _resolving = false);
    }
  }

  String _resolutionLabel(String r) => switch (r) {
        'resolved_refund' => 'استرداد كامل المبلغ للراكب',
        'resolved_release' => 'الإفراج عن المبلغ للسائق',
        'resolved_split' => 'تقسيم المبلغ بين الطرفين',
        _ => r,
      };

  @override
  Widget build(BuildContext context) {
    final detailAsync =
        ref.watch(_adminDisputeDetailProvider(widget.disputeId));

    return Scaffold(
      appBar: AppBar(title: const Text('تفاصيل النزاع — إدارة')),
      body: detailAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('$e')),
        data: (detail) {
          final dispute = detail['dispute'] as Map<String, dynamic>;
          final booking = detail['booking'] as Map<String, dynamic>?;
          final status = dispute['status'] as String? ?? 'open';
          final isResolved = status.startsWith('resolved') || status == 'closed';

          return SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _StatusChip(status: status),
                const SizedBox(height: 16),
                _PartiesCard(booking: booking, onViewProfile: (id) {
                  context.push('/users/$id');
                }),
                const SizedBox(height: 12),
                _ComplaintCard(dispute: dispute),
                const SizedBox(height: 12),
                if (dispute['otherPartyResponse'] != null)
                  _ResponseCard(dispute: dispute),
                const SizedBox(height: 12),
                if (isResolved)
                  _ResolutionResultCard(dispute: dispute)
                else ...[
                  _NotifyCard(
                    target: _notifyTarget,
                    ctrl: _msgCtrl,
                    sending: _sendingMsg,
                    onTargetChanged: (v) =>
                        setState(() => _notifyTarget = v),
                    onSend: _notify,
                  ),
                  const SizedBox(height: 12),
                  _ResolveCard(
                    notesCtrl: _notesCtrl,
                    refundCtrl: _refundCtrl,
                    resolving: _resolving,
                    blockPassenger: _blockPassenger,
                    blockDriver: _blockDriver,
                    banInstead: _banInsteadOfSuspend,
                    onBlockPassengerChanged: (v) =>
                        setState(() => _blockPassenger = v),
                    onBlockDriverChanged: (v) =>
                        setState(() => _blockDriver = v),
                    onBanChanged: (v) =>
                        setState(() => _banInsteadOfSuspend = v),
                    onResolve: (r) => _resolve(detail, r),
                  ),
                ],
              ],
            ),
          );
        },
      ),
    );
  }
}

// ── Sub-widgets ────────────────────────────────────────────────────────────────

class _StatusChip extends StatelessWidget {
  final String status;
  const _StatusChip({required this.status});

  static const _labels = {
    'open': 'مفتوح',
    'under_review': 'تحت المراجعة',
    'resolved_refund': 'تم الاسترداد',
    'resolved_release': 'تم الإفراج',
    'resolved_split': 'تم التقسيم',
    'closed': 'مغلق',
  };
  static const _colors = {
    'open': Colors.deepOrange,
    'under_review': Colors.orange,
    'resolved_refund': Colors.green,
    'resolved_release': Colors.blue,
    'resolved_split': Colors.purple,
    'closed': Colors.grey,
  };

  @override
  Widget build(BuildContext context) {
    final color = _colors[status] ?? Colors.grey;
    return Center(
      child: Container(
        padding:
            const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
        decoration: BoxDecoration(
          color: color.withOpacity(0.1),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: color),
        ),
        child: Text(
          _labels[status] ?? status,
          style: TextStyle(color: color, fontWeight: FontWeight.bold),
        ),
      ),
    );
  }
}

class _PartiesCard extends StatelessWidget {
  final Map<String, dynamic>? booking;
  final void Function(String id) onViewProfile;
  const _PartiesCard({required this.booking, required this.onViewProfile});

  @override
  Widget build(BuildContext context) {
    final driver = booking?['trip']?['driver'] as Map<String, dynamic>?;
    final passenger = booking?['passenger'] as Map<String, dynamic>?;

    String nameOf(Map<String, dynamic>? u) {
      final n = u?['fullName'] as String? ?? '';
      return n.isNotEmpty ? n : (u?['phoneNumber'] as String? ?? '?');
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('الأطراف',
                style: Theme.of(context)
                    .textTheme
                    .titleSmall
                    ?.copyWith(color: Colors.grey[600])),
            const SizedBox(height: 12),
            _PartyTile(
              label: 'السائق',
              name: nameOf(driver),
              icon: Icons.directions_car_rounded,
              color: AppColors.primary,
              onView: driver?['id'] != null
                  ? () => onViewProfile(driver!['id'] as String)
                  : null,
            ),
            const Divider(),
            _PartyTile(
              label: 'الراكب',
              name: nameOf(passenger),
              icon: Icons.person_rounded,
              color: Colors.indigo,
              onView: passenger?['id'] != null
                  ? () => onViewProfile(passenger!['id'] as String)
                  : null,
            ),
          ],
        ),
      ),
    );
  }
}

class _PartyTile extends StatelessWidget {
  final String label;
  final String name;
  final IconData icon;
  final Color color;
  final VoidCallback? onView;
  const _PartyTile({
    required this.label,
    required this.name,
    required this.icon,
    required this.color,
    required this.onView,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: CircleAvatar(
        backgroundColor: color.withOpacity(0.1),
        child: Icon(icon, color: color, size: 20),
      ),
      title: Text(name, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(label, style: TextStyle(color: Colors.grey[600])),
      trailing: onView != null
          ? IconButton(
              icon: const Icon(Icons.person_search_rounded),
              tooltip: 'عرض الملف',
              onPressed: onView,
            )
          : null,
    );
  }
}

class _ComplaintCard extends StatelessWidget {
  final Map<String, dynamic> dispute;
  const _ComplaintCard({required this.dispute});

  static const _reasonLabels = {
    'no_show_driver': 'السائق لم يحضر',
    'no_show_passenger': 'الراكب لم يحضر',
    'unsafe_driving': 'قيادة غير آمنة',
    'wrong_route': 'مسار خاطئ',
    'payment_mismatch': 'خلاف في المبلغ',
    'harassment': 'تحرش أو إزعاج',
    'other': 'أخرى',
  };

  @override
  Widget build(BuildContext context) {
    final reason = dispute['reason'] as String? ?? '';
    final desc = dispute['description'] as String? ?? '';
    final urls = (dispute['evidenceUrls'] as List?)?.length ?? 0;

    return _InfoCard(
      title: 'الشكوى',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding:
                const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: Colors.deepOrange.withOpacity(0.08),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              _reasonLabels[reason] ?? reason,
              style: const TextStyle(
                  color: Colors.deepOrange, fontWeight: FontWeight.w600),
            ),
          ),
          const SizedBox(height: 10),
          Text(desc),
          if (urls > 0) ...[
            const SizedBox(height: 8),
            Text('$urls ملف دليل',
                style:
                    TextStyle(color: Colors.grey[500], fontSize: 12)),
          ],
        ],
      ),
    );
  }
}

class _ResponseCard extends StatelessWidget {
  final Map<String, dynamic> dispute;
  const _ResponseCard({required this.dispute});

  @override
  Widget build(BuildContext context) {
    final response = dispute['otherPartyResponse'] as String? ?? '';
    final urls =
        (dispute['otherPartyEvidenceUrls'] as List?)?.length ?? 0;

    return _InfoCard(
      title: 'رد الطرف الآخر',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(response),
          if (urls > 0) ...[
            const SizedBox(height: 8),
            Text('$urls ملف دليل',
                style:
                    TextStyle(color: Colors.grey[500], fontSize: 12)),
          ],
        ],
      ),
    );
  }
}

class _ResolutionResultCard extends StatelessWidget {
  final Map<String, dynamic> dispute;
  const _ResolutionResultCard({required this.dispute});

  @override
  Widget build(BuildContext context) {
    final notes = dispute['resolutionNotes'] as String?;
    final refund = (dispute['refundAmount'] as num?)?.toDouble();

    return _InfoCard(
      title: 'قرار الإدارة',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (notes != null) Text(notes),
          if (refund != null && refund > 0) ...[
            const SizedBox(height: 8),
            Text(
              'مبلغ الاسترداد: ${refund.toStringAsFixed(0)} جنيه',
              style: const TextStyle(
                  fontWeight: FontWeight.bold,
                  color: AppColors.primary),
            ),
          ],
        ],
      ),
    );
  }
}

class _NotifyCard extends StatelessWidget {
  final String target;
  final TextEditingController ctrl;
  final bool sending;
  final void Function(String) onTargetChanged;
  final VoidCallback onSend;
  const _NotifyCard({
    required this.target,
    required this.ctrl,
    required this.sending,
    required this.onTargetChanged,
    required this.onSend,
  });

  @override
  Widget build(BuildContext context) {
    return _InfoCard(
      title: 'إرسال رسالة',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'opener', label: Text('مقدم الشكوى')),
              ButtonSegment(value: 'other_party', label: Text('الطرف الآخر')),
              ButtonSegment(value: 'both', label: Text('الاثنان')),
            ],
            selected: {target},
            onSelectionChanged: (s) => onTargetChanged(s.first),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: ctrl,
            decoration: const InputDecoration(
              hintText: 'اكتب رسالتك هنا...',
              border: OutlineInputBorder(),
            ),
            maxLines: 3,
            maxLength: 500,
          ),
          const SizedBox(height: 8),
          AppButton(
            label: 'إرسال إشعار',
            loading: sending,
            onPressed: onSend,
          ),
        ],
      ),
    );
  }
}

class _ResolveCard extends StatelessWidget {
  final TextEditingController notesCtrl;
  final TextEditingController refundCtrl;
  final bool resolving;
  final bool blockPassenger;
  final bool blockDriver;
  final bool banInstead;
  final void Function(bool) onBlockPassengerChanged;
  final void Function(bool) onBlockDriverChanged;
  final void Function(bool) onBanChanged;
  final void Function(String) onResolve;

  const _ResolveCard({
    required this.notesCtrl,
    required this.refundCtrl,
    required this.resolving,
    required this.blockPassenger,
    required this.blockDriver,
    required this.banInstead,
    required this.onBlockPassengerChanged,
    required this.onBlockDriverChanged,
    required this.onBanChanged,
    required this.onResolve,
  });

  @override
  Widget build(BuildContext context) {
    return _InfoCard(
      title: 'القرار النهائي',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: notesCtrl,
            decoration: const InputDecoration(
              labelText: 'ملاحظات القرار (مرئية لكلا الطرفين)',
              border: OutlineInputBorder(),
              alignLabelWithHint: true,
            ),
            maxLines: 3,
            maxLength: 500,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: refundCtrl,
            decoration: const InputDecoration(
              labelText: 'مبلغ الاسترداد الجزئي (للتقسيم فقط)',
              border: OutlineInputBorder(),
              suffixText: 'جنيه',
            ),
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: 16),
          // Block options
          const Text('إجراءات الحظر (اختياري)',
              style: TextStyle(fontWeight: FontWeight.w600)),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            value: blockPassenger,
            onChanged: (v) => onBlockPassengerChanged(v ?? false),
            title: const Text('حظر الراكب'),
            controlAffinity: ListTileControlAffinity.leading,
          ),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            value: blockDriver,
            onChanged: (v) => onBlockDriverChanged(v ?? false),
            title: const Text('حظر السائق'),
            controlAffinity: ListTileControlAffinity.leading,
          ),
          if (blockPassenger || blockDriver)
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: banInstead,
              onChanged: onBanChanged,
              title: Text(
                banInstead ? 'حظر دائم (بان)' : 'إيقاف مؤقت (سوسبند)',
                style: TextStyle(
                    color: banInstead ? Colors.red : Colors.orange),
              ),
            ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: _ActionButton(
                  label: 'استرداد كامل\nللراكب',
                  color: Colors.green,
                  icon: Icons.undo_rounded,
                  loading: resolving,
                  onTap: () => onResolve('resolved_refund'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _ActionButton(
                  label: 'إفراج كامل\nللسائق',
                  color: Colors.blue,
                  icon: Icons.check_circle_outline_rounded,
                  loading: resolving,
                  onTap: () => onResolve('resolved_release'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _ActionButton(
                  label: 'تقسيم\nالمبلغ',
                  color: Colors.purple,
                  icon: Icons.call_split_rounded,
                  loading: resolving,
                  onTap: () => onResolve('resolved_split'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final String label;
  final Color color;
  final IconData icon;
  final bool loading;
  final VoidCallback onTap;
  const _ActionButton({
    required this.label,
    required this.color,
    required this.icon,
    required this.loading,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: color.withOpacity(0.1),
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: loading ? null : onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 8),
          child: Column(
            children: [
              Icon(icon, color: color, size: 28),
              const SizedBox(height: 6),
              Text(
                label,
                textAlign: TextAlign.center,
                style: TextStyle(
                    color: color,
                    fontWeight: FontWeight.w600,
                    fontSize: 12),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _InfoCard extends StatelessWidget {
  final String title;
  final Widget child;
  const _InfoCard({required this.title, required this.child});

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
            const SizedBox(height: 12),
            child,
          ],
        ),
      ),
    );
  }
}
