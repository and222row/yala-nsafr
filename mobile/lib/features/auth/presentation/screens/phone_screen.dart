import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl_phone_field/intl_phone_field.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../shared/widgets/app_button.dart';
import '../../providers/auth_provider.dart';

class PhoneScreen extends ConsumerStatefulWidget {
  const PhoneScreen({super.key});

  @override
  ConsumerState<PhoneScreen> createState() => _PhoneScreenState();
}

class _PhoneScreenState extends ConsumerState<PhoneScreen> {
  String _completePhone = '';
  bool _phoneValid = false;
  bool _loading = false;
  String? _error;

  Future<void> _send() async {
    if (_completePhone.isEmpty) return;
    setState(() { _loading = true; _error = null; });
    try {
      await ref.read(authProvider.notifier).sendOtp(_completePhone);
      if (mounted) {
        context.push('/auth/otp?phone=${Uri.encodeComponent(_completePhone)}');
      }
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 60),
              Text(
                'يلا نسافر',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.headlineLarge?.copyWith(
                      color: AppColors.primary,
                      fontWeight: FontWeight.bold,
                    ),
              ),
              const SizedBox(height: 8),
              Text(
                'أدخل رقم هاتفك للمتابعة',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: Colors.grey[600]),
              ),
              const SizedBox(height: 48),
              IntlPhoneField(
                initialCountryCode: 'EG',
                decoration: const InputDecoration(labelText: 'رقم الهاتف'),
                onChanged: (phone) {
                  setState(() {
                    _completePhone = phone.completeNumber;
                    _phoneValid = phone.isValidNumber();
                  });
                },
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => _send(),
              ),
              if (_error != null) ...[
                const SizedBox(height: 8),
                Text(_error!, style: const TextStyle(color: Colors.red, fontSize: 13)),
              ],
              const SizedBox(height: 24),
              AppButton(
                label: 'إرسال رمز التحقق',
                loading: _loading,
                onPressed: _phoneValid ? _send : null,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
