import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/models/trip.dart';
import '../../../../shared/widgets/app_button.dart';
import '../../providers/trips_provider.dart';

const _cities = [
  'القاهرة', 'الإسكندرية', 'الجيزة', 'أسوان', 'الأقصر',
  'الغردقة', 'شرم الشيخ', 'بورسعيد', 'الإسماعيلية', 'السويس',
  'المنصورة', 'طنطا', 'الزقازيق', 'أسيوط', 'سوهاج',
  'المنيا', 'بني سويف', 'الفيوم', 'دمياط', 'كفر الشيخ',
];

const _cityAreas = <String, List<String>>{
  'القاهرة': [
    'مدينة نصر', 'المعادي', 'التجمع الخامس', 'المهندسين', 'الزمالك',
    'الدقي', 'شبرا', 'وسط البلد', 'مصر الجديدة', 'الهرم',
    'المطرية', 'حدائق القبة', 'عين شمس', 'حلوان',
  ],
  'الجيزة': [
    'الشيخ زايد', '6 أكتوبر', 'الدقي', 'المهندسين', 'الهرم',
    'فيصل', 'إمبابة', 'البدرشين', 'أبو النمرس',
  ],
  'الإسكندرية': [
    'سيدي جابر', 'سموحة', 'المنتزه', 'العجمي', 'الرمل',
    'المعمورة', 'ستانلي', 'بكوس', 'محطة الرمل', 'الميناء',
  ],
  'الغردقة': [
    'الهضبة', 'الكورنيش', 'المارينا', 'الممشى', 'الدهار', 'سيتى سنتر',
  ],
  'شرم الشيخ': [
    'نعمة باي', 'شرم القديم', 'الميراج', 'رأس نصراني', 'هيلتون',
  ],
  'المنصورة': [
    'المدينة', 'ميت غمر', 'طلخا', 'المنزلة',
  ],
  'طنطا': [
    'وسط البلد', 'زفتى', 'السنطة',
  ],
  'بورسعيد': [
    'البحيرة', 'العرب', 'الشرق', 'الضواحي',
  ],
};

const _otherChip = 'أخرى';

class PostTripScreen extends ConsumerStatefulWidget {
  final Trip? editTrip;
  const PostTripScreen({super.key, this.editTrip});

  bool get isEditing => editTrip != null;

  @override
  ConsumerState<PostTripScreen> createState() => _PostTripScreenState();
}

class _PostTripScreenState extends ConsumerState<PostTripScreen> {
  final _formKey = GlobalKey<FormState>();
  String? _from;
  String? _to;
  String? _fromArea;
  String? _toArea;
  final _fromAreaCtrl = TextEditingController();
  final _toAreaCtrl = TextEditingController();
  late DateTime _departure;
  late int _seats;
  final _priceCtrl = TextEditingController();
  final _notesCtrl = TextEditingController();
  late bool _womenOnly;
  late bool _smoking;
  late bool _pets;
  late bool _ac;

  @override
  void initState() {
    super.initState();
    final t = widget.editTrip;
    _from = t?.originCity;
    _to = t?.destinationCity;
    _departure = t?.departureTime ?? DateTime.now().add(const Duration(hours: 2));
    _seats = t?.totalSeats ?? 3;
    _priceCtrl.text = t != null ? t.pricePerSeat.toStringAsFixed(0) : '';
    _notesCtrl.text = t?.notes ?? '';
    _womenOnly = t?.womenOnly ?? false;
    _smoking = t?.smokingAllowed ?? false;
    _pets = t?.petsAllowed ?? false;
    _ac = t?.airConditioning ?? false;

    // Restore area if editing
    if (t?.originAddress != null) {
      final areas = _cityAreas[t!.originCity] ?? [];
      if (areas.contains(t.originAddress)) {
        _fromArea = t.originAddress;
      } else {
        _fromArea = _otherChip;
        _fromAreaCtrl.text = t.originAddress!;
      }
    }
    if (t?.destinationAddress != null) {
      final areas = _cityAreas[t!.destinationCity] ?? [];
      if (areas.contains(t.destinationAddress)) {
        _toArea = t.destinationAddress;
      } else {
        _toArea = _otherChip;
        _toAreaCtrl.text = t.destinationAddress!;
      }
    }
  }

  @override
  void dispose() {
    _priceCtrl.dispose();
    _notesCtrl.dispose();
    _fromAreaCtrl.dispose();
    _toAreaCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickDeparture() async {
    final d = await showDatePicker(
      context: context,
      initialDate: _departure,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 90)),
    );
    if (d == null || !mounted) return;
    final t = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(_departure),
    );
    if (t == null) return;
    setState(() {
      _departure = DateTime(d.year, d.month, d.day, t.hour, t.minute);
    });
  }

  String? _resolvedArea(String? area, TextEditingController ctrl) {
    if (area == null) return null;
    if (area == _otherChip) {
      final txt = ctrl.text.trim();
      return txt.isEmpty ? null : txt;
    }
    return area;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    final body = {
      if (!widget.isEditing) 'originCity': _from,
      if (!widget.isEditing) 'destinationCity': _to,
      'departureTime': _departure.toIso8601String(),
      'totalSeats': _seats,
      'pricePerSeat': double.parse(_priceCtrl.text.trim()),
      'womenOnly': _womenOnly,
      'smokingAllowed': _smoking,
      'petsAllowed': _pets,
      'airConditioning': _ac,
      'notes': _notesCtrl.text.trim(),
      if (_resolvedArea(_fromArea, _fromAreaCtrl) != null)
        'originAddress': _resolvedArea(_fromArea, _fromAreaCtrl),
      if (_resolvedArea(_toArea, _toAreaCtrl) != null)
        'destinationAddress': _resolvedArea(_toArea, _toAreaCtrl),
    };

    Trip? trip;
    if (widget.isEditing) {
      trip = await ref.read(updateTripProvider.notifier).update(widget.editTrip!.id, body);
    } else {
      trip = await ref.read(postTripProvider.notifier).post(body);
    }
    if (!mounted) return;
    if (trip != null) {
      ref.read(tripsRefreshTokenProvider.notifier).state++;
      context.go('/my-trips');
    }
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<void> actionState = widget.isEditing
        ? ref.watch(updateTripProvider)
        : ref.watch(postTripProvider);
    final loading = actionState is AsyncLoading;

    String? apiError;
    if (actionState is AsyncError) apiError = actionState.error.toString();

    final depLabel =
        '${_departure.day}/${_departure.month}/${_departure.year} '
        '${_departure.hour.toString().padLeft(2, '0')}:${_departure.minute.toString().padLeft(2, '0')}';

    return Scaffold(
      appBar: AppBar(title: Text(widget.isEditing ? 'تعديل الرحلة' : 'نشر رحلة جديدة')),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
          child: AppButton(
            label: widget.isEditing ? 'حفظ التعديلات' : 'نشر الرحلة',
            loading: loading,
            onPressed: _submit,
          ),
        ),
      ),
      body: GestureDetector(
        onTap: () => FocusScope.of(context).unfocus(),
        behavior: HitTestBehavior.translucent,
        child: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              DropdownButtonFormField<String>(
                value: _from,
                decoration: const InputDecoration(labelText: 'من'),
                items: _cities.map((c) => DropdownMenuItem(value: c, child: Text(c))).toList(),
                onChanged: widget.isEditing
                    ? null
                    : (v) => setState(() {
                          _from = v;
                          _fromArea = null;
                          _fromAreaCtrl.clear();
                        }),
                validator: (v) => v == null ? 'مطلوب' : null,
              ),
              if (_from != null && !widget.isEditing) ...[
                const SizedBox(height: 8),
                _AreaPicker(
                  city: _from!,
                  selected: _fromArea,
                  customCtrl: _fromAreaCtrl,
                  onChanged: (v) => setState(() => _fromArea = v),
                ),
              ],
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                value: _to,
                decoration: const InputDecoration(labelText: 'إلى'),
                items: _cities.map((c) => DropdownMenuItem(value: c, child: Text(c))).toList(),
                onChanged: widget.isEditing
                    ? null
                    : (v) => setState(() {
                          _to = v;
                          _toArea = null;
                          _toAreaCtrl.clear();
                        }),
                validator: (v) => v == null ? 'مطلوب' : null,
              ),
              if (_to != null && !widget.isEditing) ...[
                const SizedBox(height: 8),
                _AreaPicker(
                  city: _to!,
                  selected: _toArea,
                  customCtrl: _toAreaCtrl,
                  onChanged: (v) => setState(() => _toArea = v),
                ),
              ],
              const SizedBox(height: 12),
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(depLabel),
                subtitle: const Text('وقت الانطلاق'),
                trailing: const Icon(Icons.access_time_rounded),
                onTap: _pickDeparture,
              ),
              const Divider(),
              TextFormField(
                controller: _priceCtrl,
                decoration: const InputDecoration(
                  labelText: 'سعر المقعد (جنيه)',
                  prefixIcon: Icon(Icons.attach_money_rounded),
                ),
                keyboardType: TextInputType.number,
                validator: (v) {
                  final n = double.tryParse(v ?? '');
                  if (n == null || n <= 0) return 'أدخل سعراً صحيحاً';
                  return null;
                },
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  const Text('عدد المقاعد المتاحة'),
                  const Spacer(),
                  IconButton(
                    icon: const Icon(Icons.remove_circle_outline_rounded),
                    onPressed: _seats > 1 ? () => setState(() => _seats--) : null,
                  ),
                  Text('$_seats',
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                  IconButton(
                    icon: const Icon(Icons.add_circle_outline_rounded),
                    onPressed: _seats < 7 ? () => setState(() => _seats++) : null,
                  ),
                ],
              ),
              const Divider(),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: _womenOnly,
                onChanged: (v) => setState(() => _womenOnly = v),
                title: const Text('رحلة نساء فقط'),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: _smoking,
                onChanged: (v) => setState(() => _smoking = v),
                title: const Text('التدخين مسموح'),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: _pets,
                onChanged: (v) => setState(() => _pets = v),
                title: const Text('حيوانات أليفة مسموح'),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: _ac,
                onChanged: (v) => setState(() => _ac = v),
                title: const Text('تكييف هواء'),
                secondary: const Icon(Icons.ac_unit_rounded, color: Colors.lightBlue),
              ),
              const Divider(),
              TextFormField(
                controller: _notesCtrl,
                decoration: const InputDecoration(
                  labelText: 'ملاحظات للركاب (اختياري)',
                  hintText:
                      'مثال: سأنطلق من مطار القاهرة الترمينال 2 الساعة 12 ظهراً',
                  prefixIcon: Icon(Icons.notes_rounded),
                  alignLabelWithHint: true,
                ),
                maxLines: 3,
                minLines: 2,
                maxLength: 500,
              ),
              if (apiError != null) ...[
                const SizedBox(height: 8),
                Text(apiError,
                    style: const TextStyle(color: Colors.red, fontSize: 13)),
              ],
            ],
          ),
        ),
        ),
      ),
    );
  }
}

// ── Area picker ───────────────────────────────────────────────────────────────

class _AreaPicker extends StatelessWidget {
  final String city;
  final String? selected;
  final TextEditingController customCtrl;
  final ValueChanged<String?> onChanged;

  const _AreaPicker({
    required this.city,
    required this.selected,
    required this.customCtrl,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final areas = _cityAreas[city] ?? [];
    final chips = [...areas, _otherChip];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'نقطة الانطلاق/التحميل (اختياري)',
          style: Theme.of(context)
              .textTheme
              .labelSmall
              ?.copyWith(color: Colors.grey[600]),
        ),
        const SizedBox(height: 6),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: chips.map((chip) {
              final isSelected = selected == chip;
              return Padding(
                padding: const EdgeInsets.only(left: 6),
                child: ChoiceChip(
                  label: Text(chip, style: const TextStyle(fontSize: 12)),
                  selected: isSelected,
                  onSelected: (_) => onChanged(isSelected ? null : chip),
                  selectedColor: Theme.of(context).colorScheme.primaryContainer,
                  labelStyle: TextStyle(
                    color: isSelected
                        ? Theme.of(context).colorScheme.onPrimaryContainer
                        : null,
                    fontSize: 12,
                  ),
                ),
              );
            }).toList(),
          ),
        ),
        if (selected == _otherChip) ...[
          const SizedBox(height: 8),
          TextFormField(
            controller: customCtrl,
            decoration: const InputDecoration(
              hintText: 'اكتب نقطة الانطلاق/التحميل',
              prefixIcon: Icon(Icons.edit_location_alt_rounded, size: 20),
              isDense: true,
            ),
            maxLength: 100,
          ),
        ],
      ],
    );
  }
}
