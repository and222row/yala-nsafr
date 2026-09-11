import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/models/trip.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../shared/widgets/app_button.dart';
import '../../../notifications/providers/notifications_provider.dart';
import '../widgets/post_trip_guard.dart';

// Egyptian cities list
const _cities = [
  'القاهرة', 'الإسكندرية', 'الجيزة', 'أسوان', 'الأقصر',
  'الغردقة', 'شرم الشيخ', 'بورسعيد', 'الإسماعيلية', 'السويس',
  'المنصورة', 'طنطا', 'الزقازيق', 'أسيوط', 'سوهاج',
  'المنيا', 'بني سويف', 'الفيوم', 'دمياط', 'كفر الشيخ',
  'مرسى مطروح', 'العريش', 'الغربية', 'المنوفية',
];

class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key});

  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen> {
  String? _from;
  String? _to;
  DateTime _date = DateTime.now();
  int _seats = 1;
  bool _womenOnly = false;
  Timer? _unreadTimer;

  @override
  void initState() {
    super.initState();
    _unreadTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      ref.invalidate(unreadCountProvider);
    });
  }

  @override
  void dispose() {
    _unreadTimer?.cancel();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final d = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 90)),
    );
    if (d != null) setState(() => _date = d);
  }

  void _search() {
    if (_from == null || _to == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('اختر نقطة الانطلاق والوجهة')),
      );
      return;
    }
    context.push(
      '/trips/results',
      extra: TripSearchParams(
        from: _from!,
        to: _to!,
        date: _date,
        seats: _seats,
        womenOnly: _womenOnly,
      ),
    );
  }

  Widget _cityDropdown(String label, String? value, void Function(String?) onChanged) {
    return DropdownButtonFormField<String>(
      value: value,
      decoration: InputDecoration(labelText: label),
      items: _cities.map((c) => DropdownMenuItem(value: c, child: Text(c))).toList(),
      onChanged: onChanged,
    );
  }

  @override
  Widget build(BuildContext context) {
    final dateLabel =
        '${_date.year}/${_date.month.toString().padLeft(2, '0')}/${_date.day.toString().padLeft(2, '0')}';

    return Scaffold(
      appBar: AppBar(
        title: const Text('ابحث عن رحلة'),
        actions: [
          const _BellButton(),
          IconButton(
            icon: const Icon(Icons.add_road_rounded),
            tooltip: 'انشر رحلة',
            onPressed: () => guardedPostTrip(context, ref),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    _cityDropdown('من', _from, (v) => setState(() => _from = v)),
                    Center(
                      child: IconButton(
                        icon: const Icon(Icons.swap_vert_rounded),
                        tooltip: 'عكس المدينتين',
                        onPressed: (_from != null || _to != null)
                            ? () => setState(() {
                                  final tmp = _from;
                                  _from = _to;
                                  _to = tmp;
                                })
                            : null,
                      ),
                    ),
                    _cityDropdown('إلى', _to, (v) => setState(() => _to = v)),
                    const SizedBox(height: 12),
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(dateLabel),
                      subtitle: const Text('تاريخ السفر'),
                      trailing: const Icon(Icons.calendar_today_rounded),
                      onTap: _pickDate,
                    ),
                    const Divider(height: 1),
                    Row(
                      children: [
                        const Text('عدد المقاعد'),
                        const Spacer(),
                        IconButton(
                          icon: const Icon(Icons.remove_circle_outline_rounded),
                          onPressed: _seats > 1 ? () => setState(() => _seats--) : null,
                        ),
                        Text('$_seats',
                            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                        IconButton(
                          icon: const Icon(Icons.add_circle_outline_rounded),
                          onPressed: _seats < 4 ? () => setState(() => _seats++) : null,
                        ),
                      ],
                    ),
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      value: _womenOnly,
                      onChanged: (v) => setState(() => _womenOnly = v),
                      title: const Text('رحلات نساء فقط'),
                      activeColor: AppColors.womenOnly,
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 20),
            AppButton(label: 'بحث', onPressed: _search),
          ],
        ),
      ),
    );
  }
}

class _BellButton extends ConsumerWidget {
  const _BellButton();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final count = ref.watch(unreadCountProvider).valueOrNull ?? 0;

    return IconButton(
      tooltip: 'الإشعارات',
      icon: Badge(
        isLabelVisible: count > 0,
        label: Text(count > 9 ? '9+' : '$count'),
        child: const Icon(Icons.notifications_rounded),
      ),
      onPressed: () async {
        await context.push('/notifications');
        ref.invalidate(unreadCountProvider);
      },
    );
  }
}
