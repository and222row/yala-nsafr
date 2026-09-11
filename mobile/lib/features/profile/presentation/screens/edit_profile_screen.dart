import 'dart:io';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_endpoints.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../features/auth/providers/auth_provider.dart';
import '../../../../shared/widgets/app_button.dart';

class EditProfileScreen extends ConsumerStatefulWidget {
  const EditProfileScreen({super.key});

  @override
  ConsumerState<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends ConsumerState<EditProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _nameCtrl;
  late final TextEditingController _emergencyNameCtrl;
  late final TextEditingController _emergencyPhoneCtrl;

  String? _photoUrl;
  XFile? _pickedFile;
  bool _uploading = false;
  bool _loading = false;
  String? _error;
  String _gender = 'male';

  @override
  void initState() {
    super.initState();
    final user = ref.read(authProvider).user;
    _nameCtrl = TextEditingController(text: user?.fullName ?? '');
    _emergencyNameCtrl =
        TextEditingController(text: user?.emergencyContactName ?? '');
    _emergencyPhoneCtrl =
        TextEditingController(text: user?.emergencyContactPhone ?? '');
    _photoUrl = user?.profilePhotoUrl;
    _gender = user?.gender ?? 'male';
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _emergencyNameCtrl.dispose();
    _emergencyPhoneCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickPhoto() async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 8),
            ListTile(
              leading: const Icon(Icons.photo_library_rounded),
              title: const Text('من المعرض'),
              onTap: () => Navigator.pop(ctx, ImageSource.gallery),
            ),
            ListTile(
              leading: const Icon(Icons.camera_alt_rounded),
              title: const Text('الكاميرا'),
              onTap: () => Navigator.pop(ctx, ImageSource.camera),
            ),
          ],
        ),
      ),
    );
    if (source == null || !mounted) return;

    final file = await ImagePicker().pickImage(
      source: source,
      maxWidth: 800,
      maxHeight: 800,
      imageQuality: 85,
    );
    if (file == null || !mounted) return;

    setState(() {
      _pickedFile = file;
      _uploading = true;
    });

    try {
      final dio = ref.read(dioProvider);
      final formData = FormData.fromMap({
        'photo': await MultipartFile.fromFile(file.path, filename: 'photo.jpg'),
      });
      final resp = await dio.post<Map<String, dynamic>>(
        Endpoints.uploadPhoto,
        data: formData,
      );
      if (mounted) setState(() => _photoUrl = resp.data?['url'] as String?);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('فشل رفع الصورة: $e')),
        );
        setState(() => _pickedFile = null);
      }
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ref.read(authProvider.notifier).updateProfile({
        'fullName': _nameCtrl.text.trim(),
        'gender': _gender,
        if (_emergencyNameCtrl.text.trim().isNotEmpty)
          'emergencyContactName': _emergencyNameCtrl.text.trim(),
        if (_emergencyPhoneCtrl.text.trim().isNotEmpty)
          'emergencyContactPhone': _emergencyPhoneCtrl.text.trim(),
        if (_photoUrl != null) 'profilePhotoUrl': _photoUrl,
      });
      if (mounted) context.pop();
    } catch (e) {
      setState(
          () => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('تعديل الملف الشخصي')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // ── Avatar picker ───────────────────────────────────────────────
              Center(
                child: GestureDetector(
                  onTap: _uploading ? null : _pickPhoto,
                  child: Stack(
                    children: [
                      CircleAvatar(
                        radius: 52,
                        backgroundColor:
                            AppColors.primary.withOpacity(0.1),
                        backgroundImage: _pickedFile != null
                            ? FileImage(File(_pickedFile!.path))
                            : (_photoUrl != null
                                ? CachedNetworkImageProvider(_photoUrl!)
                                : null) as ImageProvider<Object>?,
                        child: (_pickedFile == null && _photoUrl == null)
                            ? Text(
                                ref.read(authProvider).user?.fullName
                                        .isNotEmpty ==
                                    true
                                    ? ref
                                        .read(authProvider)
                                        .user!
                                        .fullName[0]
                                    : '?',
                                style: const TextStyle(
                                  fontSize: 36,
                                  color: AppColors.primary,
                                  fontWeight: FontWeight.bold,
                                ),
                              )
                            : null,
                      ),
                      Positioned(
                        bottom: 0,
                        left: 0,
                        child: Container(
                          width: 32,
                          height: 32,
                          decoration: BoxDecoration(
                            color: AppColors.primary,
                            shape: BoxShape.circle,
                            border:
                                Border.all(color: Colors.white, width: 2),
                          ),
                          child: _uploading
                              ? const Padding(
                                  padding: EdgeInsets.all(6),
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: Colors.white,
                                  ),
                                )
                              : const Icon(
                                  Icons.camera_alt_rounded,
                                  size: 16,
                                  color: Colors.white,
                                ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 28),

              // ── Name ────────────────────────────────────────────────────────
              TextFormField(
                controller: _nameCtrl,
                decoration: const InputDecoration(
                  labelText: 'الاسم الكامل',
                  prefixIcon: Icon(Icons.person_outline_rounded),
                ),
                validator: (v) =>
                    v == null || v.trim().isEmpty ? 'الاسم مطلوب' : null,
              ),
              const SizedBox(height: 24),

              // ── Gender ──────────────────────────────────────────────────────
              Text('الجنس', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(
                      value: 'male',
                      label: Text('ذكر'),
                      icon: Icon(Icons.male_rounded)),
                  ButtonSegment(
                      value: 'female',
                      label: Text('أنثى'),
                      icon: Icon(Icons.female_rounded)),
                ],
                selected: {_gender},
                onSelectionChanged: (s) => setState(() => _gender = s.first),
              ),
              const SizedBox(height: 24),

              // ── Emergency contact ───────────────────────────────────────────
              Text('جهة الطوارئ',
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 12),
              TextFormField(
                controller: _emergencyNameCtrl,
                decoration: const InputDecoration(
                  labelText: 'الاسم',
                  prefixIcon: Icon(Icons.emergency_rounded),
                ),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _emergencyPhoneCtrl,
                decoration: const InputDecoration(
                  labelText: 'رقم الهاتف',
                  prefixIcon: Icon(Icons.phone_rounded),
                ),
                keyboardType: TextInputType.phone,
              ),

              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(_error!,
                    style:
                        const TextStyle(color: Colors.red, fontSize: 13)),
              ],
              const SizedBox(height: 32),
              AppButton(
                label: 'حفظ',
                loading: _loading || _uploading,
                onPressed: _save,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
