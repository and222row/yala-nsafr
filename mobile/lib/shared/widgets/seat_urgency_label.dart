import 'package:flutter/material.dart';

class SeatUrgencyLabel extends StatelessWidget {
  final int availableSeats;

  const SeatUrgencyLabel({super.key, required this.availableSeats});

  @override
  Widget build(BuildContext context) {
    return switch (availableSeats) {
      <= 0 => _label('لا مقاعد متاحة', Colors.grey),
      1 => _urgentLabel('آخر مقعد!', Colors.red.shade600, Icons.local_fire_department_rounded),
      2 => _urgentLabel('مقعدان فقط', Colors.deepOrange, Icons.warning_amber_rounded),
      3 || 4 => _urgentLabel('مقاعد محدودة', Colors.orange.shade700, Icons.hourglass_bottom_rounded),
      _ => _label('$availableSeats مقعد متاح', Colors.grey.shade600),
    };
  }

  Widget _urgentLabel(String text, Color color, IconData icon) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: color),
          const SizedBox(width: 3),
          Text(
            text,
            style: TextStyle(
              color: color,
              fontSize: 12,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      );

  Widget _label(String text, Color color) => Text(
        text,
        style: TextStyle(color: color, fontSize: 12),
      );
}
