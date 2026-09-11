import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../shared/widgets/app_button.dart';
import '../../providers/disputes_provider.dart';

const _passengerReasons = [
  ('no_show_driver', 'السائق لم يحضر'),
  ('unsafe_driving', 'قيادة غير آمنة'),
  ('wrong_route', 'مسار خاطئ'),
  ('payment_mismatch', 'خلاف في المبلغ'),
  ('harassment', 'تحرش أو إزعاج'),
  ('other', 'أخرى'),
];

const _driverReasons = [
  ('no_show_passenger', 'الراكب لم يحضر'),
  ('payment_mismatch', 'خلاف في المبلغ'),
  ('harassment', 'تحرش أو إزعاج'),
  ('other', 'أخرى'),
];

class OpenDisputeScreen extends ConsumerStatefulWidget {
  final String bookingId;
  final String role; // 'passenger' or 'driver'
  const OpenDisputeScreen({
    super.key,
    required this.bookingId,
    this.role = 'passenger',
  });

  @override
  ConsumerState<OpenDisputeScreen> createState() => _OpenDisputeScreenState();
}

class _OpenDisputeScreenState extends ConsumerState<OpenDisputeScreen> {
  final _formKey = GlobalKey<FormState>();
  String? _reason;
  final _descCtrl = TextEditingController();

  List<(String, String)> get _reasons =>
      widget.role == 'driver' ? _driverReasons : _passengerReasons;

  @override
  void dispose() {
    _descCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    final dispute = await ref.read(openDisputeProvider.notifier).open({
      'bookingId': widget.bookingId,
      'reason': _reason,
      'description': _descCtrl.text.trim(),
    });
    if (!mounted) return;
    if (dispute != null) {
      context.pushReplacement('/disputes/${dispute.id}');
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(openDisputeProvider);
    final loading = state is AsyncLoading;
    String? apiError;
    if (state is AsyncError) apiError = state.error.toString();

    final isDriver = widget.role == 'driver';

    return Scaffold(
      appBar: AppBar(
        title: Text(isDriver ? 'فتح نزاع على راكب' : 'فتح نزاع'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Card(
                color: Colors.orange.shade50,
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    children: [
                      Icon(Icons.info_outline_rounded,
                          color: Colors.orange.shade700),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          isDriver
                              ? 'سيتم إخطار الراكب وسيُراجع فريق يلا نسافر طلبك خلال 48 ساعة.'
                              : 'يمكن فتح النزاع خلال 48 ساعة من انتهاء الرحلة. سيُراجع فريق يلا نسافر طلبك وسيُبلَّغ السائق.',
                          style: const TextStyle(fontSize: 13),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 20),
              DropdownButtonFormField<String>(
                value: _reason,
                decoration: const InputDecoration(
                  labelText: 'سبب النزاع',
                  prefixIcon: Icon(Icons.flag_outlined),
                ),
                items: _reasons
                    .map((r) => DropdownMenuItem(value: r.$1, child: Text(r.$2)))
                    .toList(),
                onChanged: (v) => setState(() => _reason = v),
                validator: (v) => v == null ? 'اختر السبب' : null,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _descCtrl,
                decoration: const InputDecoration(
                  labelText: 'وصف المشكلة',
                  hintText: 'اشرح ما حدث بالتفصيل...',
                  alignLabelWithHint: true,
                ),
                maxLines: 5,
                maxLength: 1000,
                validator: (v) {
                  if (v == null || v.trim().length < 20) {
                    return 'اكتب وصفاً لا يقل عن 20 حرفاً';
                  }
                  return null;
                },
              ),
              if (apiError != null) ...[
                const SizedBox(height: 8),
                Text(apiError,
                    style: const TextStyle(color: Colors.red, fontSize: 13)),
              ],
              const SizedBox(height: 24),
              AppButton(
                label: 'إرسال النزاع',
                loading: loading,
                onPressed: _submit,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
