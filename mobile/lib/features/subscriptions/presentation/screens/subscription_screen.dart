import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_endpoints.dart';
import '../../../../core/theme/app_theme.dart';

class SubscriptionScreen extends ConsumerStatefulWidget {
  const SubscriptionScreen({super.key});
  @override
  ConsumerState<SubscriptionScreen> createState() => _SubscriptionScreenState();
}

class _SubscriptionScreenState extends ConsumerState<SubscriptionScreen> {
  Map<String, dynamic>? _status;
  bool _loading = true;
  bool _subscribing = false;

  @override
  void initState() {
    super.initState();
    _loadStatus();
  }

  Future<void> _loadStatus() async {
    try {
      final res = await ref.read(dioProvider).get(Endpoints.subscriptionStatus);
      setState(() { _status = res.data as Map<String, dynamic>; _loading = false; });
    } catch (_) {
      setState(() => _loading = false);
    }
  }

  Future<void> _subscribe() async {
    setState(() => _subscribing = true);
    try {
      final res = await ref.read(dioProvider).post(Endpoints.subscriptionCheckout, data: {
        'successUrl': 'https://yalansafr.app/subscription/success',
        'cancelUrl': 'https://yalansafr.app/subscription/cancel',
      });
      final url = (res.data as Map<String, dynamic>)['url'] as String?;
      if (url != null) {
        await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _subscribing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(body: Center(child: CircularProgressIndicator()));

    final canPost = _status?['canPost'] as bool? ?? false;
    final isFreeTrial = _status?['isFreeTrial'] as bool? ?? false;
    final trialDaysLeft = _status?['trialDaysLeft'] as int? ?? 0;
    final hasSub = (_status?['subscription'] as Map?)?.isNotEmpty ?? false;

    return Scaffold(
      appBar: AppBar(title: const Text('النسخة المدفوعة')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Badge icon
            Center(
              child: Container(
                width: 80, height: 80,
                decoration: BoxDecoration(
                  color: AppColors.primary.withOpacity(0.1),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.workspace_premium_rounded, size: 44, color: AppColors.primary),
              ),
            ),
            const SizedBox(height: 16),
            const Center(
              child: Text('يلا نسافر Pro', style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
            ),
            const SizedBox(height: 4),
            const Center(
              child: Text('200 جنيه / شهر', style: TextStyle(fontSize: 16, color: Colors.grey)),
            ),
            const SizedBox(height: 24),

            // Status banner
            if (isFreeTrial)
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: Colors.green.shade50,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.green.shade200),
                ),
                child: Row(children: [
                  Icon(Icons.check_circle_rounded, color: Colors.green.shade600),
                  const SizedBox(width: 10),
                  Expanded(child: Text(
                    'أنت في الفترة المجانية — متبقي $trialDaysLeft يوم',
                    style: TextStyle(color: Colors.green.shade700, fontWeight: FontWeight.w600),
                  )),
                ]),
              )
            else if (hasSub)
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppColors.primary.withOpacity(0.08),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Row(children: [
                  Icon(Icons.workspace_premium_rounded, color: AppColors.primary),
                  SizedBox(width: 10),
                  Text('اشتراكك نشط ✅', style: TextStyle(fontWeight: FontWeight.w600, color: AppColors.primary)),
                ]),
              )
            else
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: Colors.orange.shade50,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.orange.shade200),
                ),
                child: Row(children: [
                  Icon(Icons.warning_amber_rounded, color: Colors.orange.shade700),
                  const SizedBox(width: 10),
                  const Expanded(child: Text(
                    'انتهت فترتك المجانية. اشترك للاستمرار في نشر الرحلات.',
                    style: TextStyle(color: Colors.orange),
                  )),
                ]),
              ),

            const SizedBox(height: 24),

            // Features list
            const _Feature(Icons.add_road_rounded, 'نشر رحلات غير محدودة'),
            const _Feature(Icons.workspace_premium_rounded, 'شارة Pro على ملفك الشخصي'),
            const _Feature(Icons.priority_high_rounded, 'ظهور متميز في نتائج البحث'),
            const _Feature(Icons.support_agent_rounded, 'دعم أولوية'),

            const SizedBox(height: 32),

            if (!hasSub)
              FilledButton.icon(
                icon: _subscribing
                    ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.payment_rounded),
                label: Text(_subscribing ? 'جاري التوجيه...' : 'اشترك الآن — 200 جنيه/شهر'),
                onPressed: _subscribing ? null : _subscribe,
                style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
              ),
          ],
        ),
      ),
    );
  }
}

class _Feature extends StatelessWidget {
  final IconData icon;
  final String label;
  const _Feature(this.icon, this.label);

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 6),
    child: Row(children: [
      Icon(icon, color: AppColors.primary, size: 20),
      const SizedBox(width: 12),
      Text(label, style: const TextStyle(fontSize: 15)),
    ]),
  );
}
