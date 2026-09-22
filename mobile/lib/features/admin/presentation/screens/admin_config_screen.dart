import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/api/api_client.dart';
import '../widgets/admin_scaffold.dart';

final _configProvider =
    FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  final resp = await ref.read(dioProvider).get('/admin/config');
  return resp.data as Map<String, dynamic>;
});

class AdminConfigScreen extends ConsumerStatefulWidget {
  const AdminConfigScreen({super.key});

  @override
  ConsumerState<AdminConfigScreen> createState() => _AdminConfigScreenState();
}

class _AdminConfigScreenState extends ConsumerState<AdminConfigScreen> {
  // Editable fields
  final _commissionCtrl = TextEditingController();
  final _autoConfirmCtrl = TextEditingController();
  final _disputeWindowCtrl = TextEditingController();
  final _disputeSlaCtrl = TextEditingController();
  final _ratingRevealCtrl = TextEditingController();

  bool _saving = false;
  String? _saveError;
  bool _saved = false;
  bool _initialized = false;

  @override
  void dispose() {
    _commissionCtrl.dispose();
    _autoConfirmCtrl.dispose();
    _disputeWindowCtrl.dispose();
    _disputeSlaCtrl.dispose();
    _ratingRevealCtrl.dispose();
    super.dispose();
  }

  void _populate(Map<String, dynamic> config) {
    if (_initialized) return;
    _initialized = true;
    _commissionCtrl.text =
        ((double.tryParse(config['commission_rate']?.toString() ?? '0.10') ?? 0.10) * 100)
            .toStringAsFixed(0);
    _autoConfirmCtrl.text = config['auto_confirm_hours']?.toString() ?? '2';
    _disputeWindowCtrl.text =
        config['dispute_window_hours']?.toString() ?? '48';
    _disputeSlaCtrl.text = config['dispute_sla_hours']?.toString() ?? '48';
    _ratingRevealCtrl.text =
        config['rating_reveal_days']?.toString() ?? '7';
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _saveError = null;
      _saved = false;
    });
    try {
      final commission = double.tryParse(_commissionCtrl.text);
      final autoConfirm = int.tryParse(_autoConfirmCtrl.text);
      final disputeWindow = int.tryParse(_disputeWindowCtrl.text);
      final disputeSla = int.tryParse(_disputeSlaCtrl.text);
      final ratingReveal = int.tryParse(_ratingRevealCtrl.text);

      if (commission == null || commission < 0 || commission > 50) {
        throw Exception('نسبة العمولة يجب أن تكون بين 0 و 50%');
      }

      await ref.read(dioProvider).patch('/admin/config', data: {
        if (autoConfirm != null) 'autoConfirmHours': autoConfirm,
        if (disputeWindow != null) 'disputeWindowHours': disputeWindow,
        if (disputeSla != null) 'disputeSlaHours': disputeSla,
        if (ratingReveal != null) 'ratingRevealDays': ratingReveal,
        'commissionRate': commission / 100,
      });
      ref.invalidate(_configProvider);
      setState(() => _saved = true);
    } catch (e) {
      setState(() => _saveError = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final configAsync = ref.watch(_configProvider);
    return AdminScaffold(
      title: 'الإعدادات',
      body: configAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('$e')),
        data: (config) {
          _populate(config);
          return SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // ── Editable section ─────────────────────────────────────────
                Text('إعدادات قابلة للتعديل',
                    style: Theme.of(context).textTheme.titleSmall),
                const SizedBox(height: 10),
                _Field(
                  ctrl: _commissionCtrl,
                  label: 'نسبة العمولة (%)',
                  hint: 'مثال: 7 = 7%',
                  icon: Icons.percent_rounded,
                  keyboardType: TextInputType.number,
                ),
                const SizedBox(height: 12),
                _Field(
                  ctrl: _autoConfirmCtrl,
                  label: 'تأكيد الوصول التلقائي (ساعة)',
                  hint: 'عدد الساعات بعد انتهاء الرحلة',
                  icon: Icons.check_circle_rounded,
                  keyboardType: TextInputType.number,
                ),
                const SizedBox(height: 12),
                _Field(
                  ctrl: _disputeWindowCtrl,
                  label: 'نافذة النزاع (ساعة)',
                  hint: 'المدة المسموح فيها بفتح نزاع',
                  icon: Icons.gavel_rounded,
                  keyboardType: TextInputType.number,
                ),
                const SizedBox(height: 12),
                _Field(
                  ctrl: _disputeSlaCtrl,
                  label: 'مهلة الرد على النزاع (ساعة)',
                  hint: 'المدة المتاحة للطرف الآخر للرد قبل الحسم التلقائي',
                  icon: Icons.timer_rounded,
                  keyboardType: TextInputType.number,
                ),
                const SizedBox(height: 12),
                _Field(
                  ctrl: _ratingRevealCtrl,
                  label: 'كشف التقييمات (يوم)',
                  hint: 'عدد الأيام قبل الكشف المتبادل',
                  icon: Icons.star_rounded,
                  keyboardType: TextInputType.number,
                ),
                const SizedBox(height: 20),
                if (_saveError != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Text(_saveError!,
                        style: const TextStyle(color: Colors.red)),
                  ),
                if (_saved)
                  const Padding(
                    padding: EdgeInsets.only(bottom: 10),
                    child: Text('تم الحفظ بنجاح ✅',
                        style: TextStyle(color: Colors.green)),
                  ),
                FilledButton(
                  onPressed: _saving ? null : _save,
                  child: _saving
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white))
                      : const Text('حفظ الإعدادات'),
                ),

                // ── Read-only section ────────────────────────────────────────
                const SizedBox(height: 28),
                Text('إعدادات النظام (للعرض فقط)',
                    style: Theme.of(context).textTheme.titleSmall),
                const SizedBox(height: 10),
                _ReadOnly(
                  label: 'حد التقييم المنخفض',
                  value: config['low_rating_threshold']?.toString() ?? '-',
                  icon: Icons.star_border_rounded,
                ),
                _ReadOnly(
                  label: 'الحد الأدنى للتقييمات قبل الإبلاغ',
                  value: config['min_ratings_for_flag']?.toString() ?? '-',
                  icon: Icons.flag_rounded,
                ),
                _ReadOnly(
                  label: 'إلغاء مجاني (ساعة)',
                  value: config['free_cancel_hours']?.toString() ?? '-',
                  icon: Icons.cancel_rounded,
                ),
                _ReadOnly(
                  label: 'إلغاء متأخر (ساعة)',
                  value: config['late_cancel_hours']?.toString() ?? '-',
                  icon: Icons.timer_rounded,
                ),
                _ReadOnly(
                  label: 'رسوم الإلغاء المتأخر (%)',
                  value: '${((double.tryParse(config['late_cancel_fee_pct']?.toString() ?? '0') ?? 0) * 100).toStringAsFixed(0)}%',
                  icon: Icons.money_off_rounded,
                ),
                _ReadOnly(
                  label: 'تعويض السائق (%)',
                  value: '${((double.tryParse(config['driver_compensation_pct']?.toString() ?? '0') ?? 0) * 100).toStringAsFixed(0)}%',
                  icon: Icons.payments_rounded,
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _Field extends StatelessWidget {
  final TextEditingController ctrl;
  final String label;
  final String hint;
  final IconData icon;
  final TextInputType keyboardType;
  const _Field({required this.ctrl, required this.label, required this.hint, required this.icon, required this.keyboardType});

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: ctrl,
      keyboardType: keyboardType,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        prefixIcon: Icon(icon),
        isDense: true,
      ),
    );
  }
}

class _ReadOnly extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  const _ReadOnly({required this.label, required this.value, required this.icon});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      dense: true,
      leading: Icon(icon, size: 20, color: Colors.grey),
      title: Text(label, style: const TextStyle(fontSize: 13)),
      trailing: Text(value,
          style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
    );
  }
}
