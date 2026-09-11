import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:dio/dio.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_endpoints.dart';
import '../../../../shared/widgets/app_button.dart';
import '../../providers/auth_provider.dart';

class ProfileSetupScreen extends ConsumerStatefulWidget {
  const ProfileSetupScreen({super.key});

  @override
  ConsumerState<ProfileSetupScreen> createState() => _ProfileSetupScreenState();
}

class _ProfileSetupScreenState extends ConsumerState<ProfileSetupScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameCtrl = TextEditingController();
  final _referralCtrl = TextEditingController();
  String _gender = 'male';
  bool _loading = false;
  String? _error;
  String? _referralSuccess;

  @override
  void dispose() {
    _nameCtrl.dispose();
    _referralCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() { _loading = true; _error = null; _referralSuccess = null; });
    try {
      await ref.read(authProvider.notifier).updateProfile({
        'fullName': _nameCtrl.text.trim(),
        'gender': _gender,
      });

      final referralCode = _referralCtrl.text.trim().toUpperCase();
      if (referralCode.isNotEmpty) {
        try {
          final dio = ref.read(dioProvider);
          final res = await dio.post(Endpoints.applyReferral, data: {'code': referralCode});
          final msg = (res.data as Map<String, dynamic>)['message'] as String?;
          await ref.read(authProvider.notifier).refreshUser();
          if (mounted) setState(() => _referralSuccess = msg);
          await Future.delayed(const Duration(seconds: 2));
        } on DioException catch (e) {
          // Referral errors are non-fatal — profile is already saved
          final msg = (e.response?.data as Map<String, dynamic>?)?['message'] as String?;
          if (mounted) setState(() => _error = msg ?? 'كود الدعوة غير صحيح');
          await Future.delayed(const Duration(seconds: 2));
        }
      }

      if (mounted) context.go('/search');
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('إنشاء حسابك')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SizedBox(height: 16),
                TextFormField(
                  controller: _nameCtrl,
                  decoration: const InputDecoration(
                    labelText: 'الاسم الكامل',
                    prefixIcon: Icon(Icons.person_outline_rounded),
                  ),
                  validator: (v) =>
                      v == null || v.trim().isEmpty ? 'الاسم مطلوب' : null,
                  textInputAction: TextInputAction.next,
                ),
                const SizedBox(height: 24),
                Text('الجنس', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                SegmentedButton<String>(
                  segments: const [
                    ButtonSegment(value: 'male', label: Text('ذكر')),
                    ButtonSegment(value: 'female', label: Text('أنثى')),
                  ],
                  selected: {_gender},
                  onSelectionChanged: (s) => setState(() => _gender = s.first),
                ),
                const SizedBox(height: 24),
                TextFormField(
                  controller: _referralCtrl,
                  decoration: const InputDecoration(
                    labelText: 'كود دعوة صديق (اختياري)',
                    prefixIcon: Icon(Icons.card_giftcard_rounded),
                    hintText: 'مثال: AHMED3',
                    helperText: 'احصل على 20 جنيه رصيد ترحيبي عند إدخال كود صديق',
                  ),
                  textCapitalization: TextCapitalization.characters,
                  maxLength: 6,
                  textInputAction: TextInputAction.done,
                ),
                if (_referralSuccess != null) ...[
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      const Icon(Icons.check_circle_rounded,
                          color: Colors.green, size: 18),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(_referralSuccess!,
                            style: const TextStyle(
                                color: Colors.green, fontSize: 13)),
                      ),
                    ],
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  Text(_error!,
                      style: const TextStyle(color: Colors.red, fontSize: 13)),
                ],
                const Spacer(),
                AppButton(
                  label: 'حفظ ومتابعة',
                  loading: _loading,
                  onPressed: _save,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
