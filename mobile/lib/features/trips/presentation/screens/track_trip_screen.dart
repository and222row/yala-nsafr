import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../features/auth/providers/auth_provider.dart';
import '../../providers/location_provider.dart';
import '../../providers/trips_provider.dart';

class TrackTripScreen extends ConsumerWidget {
  final String tripId;
  final bool isDriver;

  const TrackTripScreen({
    super.key,
    required this.tripId,
    required this.isDriver,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return isDriver
        ? _DriverView(tripId: tripId)
        : _PassengerMap(tripId: tripId);
  }
}

// ── Driver view ────────────────────────────────────────────────────────────────

class _DriverView extends ConsumerStatefulWidget {
  final String tripId;
  const _DriverView({required this.tripId});

  @override
  ConsumerState<_DriverView> createState() => _DriverViewState();
}

class _DriverViewState extends ConsumerState<_DriverView> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(driverLocationProvider(widget.tripId).notifier).start();
    });
  }

  @override
  void dispose() {
    ref.read(driverLocationProvider(widget.tripId).notifier).stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isPosting = ref.watch(driverLocationProvider(widget.tripId));

    return Scaffold(
      appBar: AppBar(title: const Text('مشاركة الموقع')),
      floatingActionButton: _SosFab(tripId: widget.tripId),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                isPosting
                    ? Icons.location_on_rounded
                    : Icons.location_off_rounded,
                size: 88,
                color: isPosting ? AppColors.primary : Colors.grey,
              ),
              const SizedBox(height: 24),
              Text(
                isPosting
                    ? 'موقعك يُشارك مع الركاب'
                    : 'جاري تفعيل مشاركة الموقع…',
                style:
                    const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 10),
              Text(
                'يتم إرسال موقعك تلقائياً كل دقيقة\nابقِ التطبيق مفتوحاً أثناء القيادة',
                style: TextStyle(
                    color: Colors.grey[600], fontSize: 14, height: 1.6),
                textAlign: TextAlign.center,
              ),
              if (isPosting) ...[
                const SizedBox(height: 32),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                  decoration: BoxDecoration(
                    color: AppColors.primary.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(20),
                    border:
                        Border.all(color: AppColors.primary.withOpacity(0.3)),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.circle, color: AppColors.primary, size: 10),
                      SizedBox(width: 8),
                      Text('بث مباشر',
                          style: TextStyle(
                              color: AppColors.primary,
                              fontWeight: FontWeight.bold)),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

// ── Passenger map ──────────────────────────────────────────────────────────────

class _PassengerMap extends ConsumerStatefulWidget {
  final String tripId;
  const _PassengerMap({required this.tripId});

  @override
  ConsumerState<_PassengerMap> createState() => _PassengerMapState();
}

class _PassengerMapState extends ConsumerState<_PassengerMap> {
  final _mapController = MapController();
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    _pollTimer = Timer.periodic(const Duration(minutes: 1), (_) {
      if (mounted) ref.invalidate(tripLocationProvider(widget.tripId));
    });
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _mapController.dispose();
    super.dispose();
  }

  void _moveTo(LatLng point) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      try {
        _mapController.move(point, 15);
      } catch (_) {}
    });
  }

  @override
  Widget build(BuildContext context) {
    final locationAsync = ref.watch(tripLocationProvider(widget.tripId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('تتبع الرحلة'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'تحديث الآن',
            onPressed: () =>
                ref.invalidate(tripLocationProvider(widget.tripId)),
          ),
        ],
      ),
      floatingActionButton: _SosFab(tripId: widget.tripId),
      body: locationAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (_, __) => Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.wifi_off_rounded, size: 56, color: Colors.grey),
              const SizedBox(height: 12),
              const Text('تعذر تحميل الموقع',
                  style: TextStyle(fontSize: 15)),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: () =>
                    ref.invalidate(tripLocationProvider(widget.tripId)),
                child: const Text('إعادة المحاولة'),
              ),
            ],
          ),
        ),
        data: (location) {
          if (location == null) {
            return const Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.location_searching_rounded,
                      size: 72, color: Colors.grey),
                  SizedBox(height: 16),
                  Text(
                    'في انتظار مشاركة الموقع من السائق',
                    style: TextStyle(color: Colors.grey, fontSize: 15),
                    textAlign: TextAlign.center,
                  ),
                  SizedBox(height: 8),
                  Text(
                    'يتم التحديث تلقائياً كل دقيقة',
                    style: TextStyle(color: Colors.grey, fontSize: 13),
                  ),
                ],
              ),
            );
          }

          final point = LatLng(location.latitude, location.longitude);
          _moveTo(point);

          return Stack(
            children: [
              FlutterMap(
                mapController: _mapController,
                options:
                    MapOptions(initialCenter: point, initialZoom: 15),
                children: [
                  TileLayer(
                    urlTemplate:
                        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                    userAgentPackageName: 'com.yalansafr.app',
                  ),
                  MarkerLayer(
                    markers: [
                      Marker(
                        point: point,
                        width: 52,
                        height: 52,
                        child: const Icon(
                          Icons.directions_car_rounded,
                          size: 40,
                          color: AppColors.primary,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              Positioned(
                bottom: 90, // above FAB
                left: 16,
                right: 80,
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 16, vertical: 10),
                    child: Row(
                      children: [
                        const Icon(Icons.access_time_rounded,
                            size: 16, color: Colors.grey),
                        const SizedBox(width: 8),
                        Text(
                          'آخر تحديث: ${_fmt(location.recordedAt)}',
                          style: const TextStyle(fontSize: 13),
                        ),
                        const Spacer(),
                        const Icon(Icons.circle,
                            color: AppColors.primary, size: 8),
                        const SizedBox(width: 4),
                        const Text('مباشر',
                            style: TextStyle(
                                color: AppColors.primary,
                                fontSize: 12,
                                fontWeight: FontWeight.bold)),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  String _fmt(DateTime dt) =>
      '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
}

// ── SOS FAB ───────────────────────────────────────────────────────────────────

class _SosFab extends ConsumerStatefulWidget {
  final String tripId;
  const _SosFab({required this.tripId});

  @override
  ConsumerState<_SosFab> createState() => _SosFabState();
}

class _SosFabState extends ConsumerState<_SosFab>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl;
  bool _triggered = false;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2500),
    )..addStatusListener((s) {
        if (s == AnimationStatus.completed && !_triggered) {
          _triggered = true;
          _activate();
        }
      });
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  void _onLongPressStart(LongPressStartDetails _) => _ctrl.forward();

  void _onLongPressEnd(LongPressEndDetails _) {
    if (!_triggered) _ctrl.reverse();
  }

  void _onLongPressCancel() {
    if (!_triggered) _ctrl.reverse();
  }

  Future<void> _activate() async {
    HapticFeedback.heavyImpact();

    final user = ref.read(authProvider).user;
    final contactPhone = user?.emergencyContactPhone;
    final contactName = user?.emergencyContactName;

    // Backend notification — fire-and-forget, don't block
    reportSos(ref, widget.tripId).catchError((_) {});

    // Best-effort GPS for SMS body
    String? mapsLink;
    try {
      final pos = await Geolocator.getLastKnownPosition();
      if (pos != null) {
        mapsLink =
            'https://maps.google.com/?q=${pos.latitude},${pos.longitude}';
      }
    } catch (_) {}

    final smsBody = 'أحتاج مساعدة عاجلة! أنا في رحلة يلا نسافر.'
        '${mapsLink != null ? '\nموقعي: $mapsLink' : ''}';

    // Open emergency contact dialer immediately
    if (contactPhone != null && mounted) {
      launchUrl(Uri.parse('tel:$contactPhone')).catchError((_) async => false);
    }

    if (!mounted) return;
    await showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => _SosModal(
        contactPhone: contactPhone,
        contactName: contactName,
        smsBody: smsBody,
      ),
    );

    if (mounted) {
      setState(() => _triggered = false);
      _ctrl.reset();
    }
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('اضغط مطولاً 3 ثوانٍ لتفعيل الطوارئ'),
          duration: Duration(seconds: 2),
          behavior: SnackBarBehavior.floating,
        ),
      ),
      onLongPressStart: _onLongPressStart,
      onLongPressEnd: _onLongPressEnd,
      onLongPressCancel: _onLongPressCancel,
      child: AnimatedBuilder(
        animation: _ctrl,
        builder: (_, __) => SizedBox(
          width: 72,
          height: 72,
          child: Stack(
            alignment: Alignment.center,
            children: [
              SizedBox(
                width: 72,
                height: 72,
                child: CircularProgressIndicator(
                  value: _ctrl.value,
                  strokeWidth: 5,
                  color: Colors.red.shade300,
                  backgroundColor: Colors.red.withOpacity(0.15),
                ),
              ),
              Container(
                width: 56,
                height: 56,
                decoration: BoxDecoration(
                  color: Colors.red,
                  shape: BoxShape.circle,
                  boxShadow: [
                    BoxShadow(
                      color: Colors.red.withOpacity(0.45),
                      blurRadius: 14,
                      spreadRadius: 2,
                    ),
                  ],
                ),
                child: const Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.sos_rounded, color: Colors.white, size: 26),
                    Text(
                      'SOS',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 9,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 1.5,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ── SOS activated modal ───────────────────────────────────────────────────────

class _SosModal extends StatelessWidget {
  final String? contactPhone;
  final String? contactName;
  final String smsBody;

  const _SosModal({
    required this.contactPhone,
    required this.contactName,
    required this.smsBody,
  });

  Future<void> _call(String number) async {
    await launchUrl(Uri.parse('tel:$number'));
  }

  Future<void> _sms(String phone) async {
    final encoded = Uri.encodeFull(smsBody);
    await launchUrl(Uri.parse('sms:$phone?body=$encoded'));
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 24, 24, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Header
            Container(
              width: 72,
              height: 72,
              decoration: const BoxDecoration(
                  color: Colors.red, shape: BoxShape.circle),
              child:
                  const Icon(Icons.sos_rounded, color: Colors.white, size: 40),
            ),
            const SizedBox(height: 16),
            const Text(
              'تم إرسال تنبيه الطوارئ',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 6),
            const Text(
              'فريق يلا نسافر تم إخطاره',
              style: TextStyle(color: Colors.grey, fontSize: 13),
            ),
            const SizedBox(height: 24),

            // Emergency contact buttons
            if (contactPhone != null) ...[
              _SosButton(
                icon: Icons.phone_rounded,
                label:
                    'اتصل بـ ${contactName?.isNotEmpty == true ? contactName! : contactPhone!}',
                color: Colors.green,
                onTap: () => _call(contactPhone!),
              ),
              const SizedBox(height: 8),
              _SosButton(
                icon: Icons.sms_rounded,
                label: 'إرسال SMS مع الموقع',
                color: Colors.teal,
                onTap: () => _sms(contactPhone!),
              ),
              const SizedBox(height: 16),
              const Row(
                children: [
                  Expanded(child: Divider()),
                  Padding(
                    padding: EdgeInsets.symmetric(horizontal: 10),
                    child: Text('أرقام الطوارئ',
                        style: TextStyle(color: Colors.grey, fontSize: 12)),
                  ),
                  Expanded(child: Divider()),
                ],
              ),
              const SizedBox(height: 12),
            ],

            // Egyptian emergency numbers
            Row(
              children: [
                Expanded(
                  child: _SosButton(
                    icon: Icons.local_police_rounded,
                    label: 'الشرطة\n123',
                    color: Colors.blue[700]!,
                    onTap: () => _call('123'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _SosButton(
                    icon: Icons.emergency_rounded,
                    label: 'الإسعاف\n122',
                    color: Colors.orange[800]!,
                    onTap: () => _call('122'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('إغلاق'),
            ),
          ],
        ),
      ),
    );
  }
}

class _SosButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  const _SosButton({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: color.withOpacity(0.08),
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 14),
          child: Row(
            children: [
              Icon(icon, color: color, size: 22),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(
                      color: color,
                      fontWeight: FontWeight.w600,
                      fontSize: 13,
                      height: 1.4),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
