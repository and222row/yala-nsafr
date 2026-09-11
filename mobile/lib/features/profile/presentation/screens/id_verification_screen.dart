import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_endpoints.dart';
import '../../../../features/auth/providers/auth_provider.dart';
import '../../../../shared/widgets/app_button.dart';

class IdVerificationScreen extends ConsumerStatefulWidget {
  const IdVerificationScreen({super.key});

  @override
  ConsumerState<IdVerificationScreen> createState() =>
      _IdVerificationScreenState();
}

class _IdVerificationScreenState extends ConsumerState<IdVerificationScreen> {
  final _nationalIdCtrl = TextEditingController();
  bool _loading = false;
  String? _error;
  bool _submitted = false;

  @override
  void dispose() {
    _nationalIdCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final id = _nationalIdCtrl.text.trim();
    if (id.length < 14) {
      setState(() => _error = 'الرقم القومي يجب أن يكون 14 رقماً');
      return;
    }
    setState(() { _loading = true; _error = null; });
    try {
      final dio = ref.read(dioProvider);
      await dio.post(Endpoints.idVerification, data: {'nationalIdNumber': id});
      await ref.read(authProvider.notifier).refreshUser();
      setState(() => _submitted = true);
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_submitted) {
      return Scaffold(
        appBar: AppBar(title: const Text('التحقق من الهوية')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.hourglass_top_rounded,
                    size: 72, color: Colors.orange),
                const SizedBox(height: 16),
                const Text(
                  'تم إرسال طلب التحقق\nسيتم مراجعته خلال 24 ساعة',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 18),
                ),
                const SizedBox(height: 24),
                AppButton(
                  label: 'العودة للملف الشخصي',
                  onPressed: () => context.go('/profile'),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('التحقق من الهوية')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'أدخل رقمك القومي للتحقق من هويتك. يساعد ذلك في بناء الثقة بين المستخدمين.',
              style: TextStyle(fontSize: 15),
            ),
            const SizedBox(height: 24),
            TextFormField(
              controller: _nationalIdCtrl,
              decoration: const InputDecoration(
                labelText: 'الرقم القومي (14 رقماً)',
                prefixIcon: Icon(Icons.badge_rounded),
              ),
              keyboardType: TextInputType.number,
              maxLength: 14,
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(_error!,
                  style: const TextStyle(color: Colors.red, fontSize: 13)),
            ],
            const Spacer(),
            AppButton(
              label: 'إرسال للمراجعة',
              loading: _loading,
              onPressed: _submit,
            ),
          ],
        ),
      ),
    );
  }
}
